import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  Modal,
  Alert,
} from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useSanityQuizQuestions } from '@/hooks/sanity/useSanityQuizzes';
import { useSanitySubmoduleWithLessons } from '@/hooks/sanity/useSanitySubmodules';
import { useSanityLessonQuizzes } from '@/hooks/sanity/useSanityQuizzes';
import { useSanityLesson } from '@/hooks/sanity/useSanityLessons';
import { useSanityModule } from '@/hooks/sanity/useSanityModules';
import RichTextRenderer from '@/components/sanity/RichTextRenderer';
import SubmoduleProgressBar from '@/components/learn/SubmoduleProgressBar';
import {
  calculateQuizProgress,
  getLessonTotalPages,
} from '@/utils/submoduleProgress';
import { useLessonProgress } from '@/hooks/progress/useLessonProgress';
import { hasLoadedContentItem } from '@/utils/learnCompletionNavigation';
import {
  getOrCreateInProgressQuizAttempt,
  getQuizResponses,
  submitQuizAnswer,
  markQuizAttemptComplete,
  saveResumePosition,
} from '@/services/progress/progressService';
import { useAnalytics } from '@/utils/analytics';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

// Grade a single/multiple-choice answer for a given question. Module-level so it
// can be used both in the render body and inside the attempt-resolution effect
// (which flushes a selection made before the attempt id was ready).
function gradeQuizAnswer(question: any, answer: string | string[]): boolean {
  if (!question) return false;
  if (question.question_type === 'multiple_choice_multiple') {
    const correctIds = (
      question.options?.filter((o: any) => o.is_correct) || []
    ).map((o: any) => o._key);
    const arr = Array.isArray(answer) ? answer : [];
    return (
      correctIds.length > 0 &&
      correctIds.every((id: string) => arr.includes(id)) &&
      arr.every((id: string) => correctIds.includes(id))
    );
  }
  const correctAnswerId =
    question.correct_answer?.value?.[0] || question.correct_answer?.value;
  const single = Array.isArray(answer) ? answer[0] : answer;
  return (
    single === correctAnswerId ||
    !!question.options?.find((o: any) => o._key === single)?.is_correct
  );
}

export default function QuizQuestionPage() {
  const { moduleId, submoduleId, lessonId, quizId, questionNum } =
    useLocalSearchParams<{
      moduleId: string;
      submoduleId: string;
      lessonId: string;
      quizId: string;
      questionNum: string;
    }>();
  const { t } = useTranslation();
  const { trackScreen, capture } = useAnalytics();
  const currentQuestionIndex = parseInt(questionNum || '1') - 1;
  const { data: questions, isLoading, error } = useSanityQuizQuestions(quizId);
  const {
    data: quizzes,
    isLoading: quizzesLoading,
    error: quizzesError,
  } = useSanityLessonQuizzes(lessonId);
  const {
    data: lesson,
    isLoading: lessonLoading,
    error: lessonError,
  } = useSanityLesson(lessonId || '');
  const {
    data: submoduleData,
    isLoading: submoduleLoading,
    error: submoduleError,
  } = useSanitySubmoduleWithLessons(submoduleId);
  const { data: moduleData } = useSanityModule(moduleId || '');
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<string[]>([]);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);

  // Matching question state (right side tracked by index so duplicate values select only one)
  const [selectedLeftItem, setSelectedLeftItem] = useState<string | null>(null);
  const [selectedRightIndex, setSelectedRightIndex] = useState<number | null>(
    null
  );
  const [matchedPairs, setMatchedPairs] = useState<{ [key: string]: string }>(
    {}
  );
  const [completedLeftItems, setCompletedLeftItems] = useState<string[]>([]);
  const [completedRightIndices, setCompletedRightIndices] = useState<number[]>(
    []
  );
  const [incorrectLeftItems, setIncorrectLeftItems] = useState<string[]>([]);
  const [incorrectRightIndices, setIncorrectRightIndices] = useState<number[]>(
    []
  );
  const [showExitModal, setShowExitModal] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  // Id of the current in-progress quiz attempt; answers are saved against it so
  // selections survive Next/Back and exiting/re-entering the quiz.
  const [attemptId, setAttemptId] = useState<string | null>(null);
  // True once the user picks an answer on this question. Guards the async restore
  // from overwriting a fresh selection if getQuizResponses resolves after the tap.
  const answerTouchedRef = useRef(false);
  // Holds a selection made before the attempt id resolved, so it still gets
  // persisted once the attempt is ready (instead of being silently dropped).
  const pendingAnswerRef = useRef<string | string[] | null>(null);

  // Progress tracking
  const { saveLessonCompletion } = useLessonProgress();

  // Resolve (or create) the in-progress attempt once per quiz.
  useEffect(() => {
    if (!quizId || !lessonId || !submoduleId || !moduleId) return;
    let cancelled = false;
    getOrCreateInProgressQuizAttempt(
      quizId,
      lessonId,
      submoduleId,
      moduleId
    ).then(id => {
      if (cancelled) return;
      setAttemptId(id);
      // Flush a selection the user made before the attempt id was ready.
      const pending = pendingAnswerRef.current;
      if (id && pending != null) {
        const q = questions?.[currentQuestionIndex];
        if (q?._key) {
          submitQuizAnswer(
            id,
            q._key,
            q.question_type,
            pending,
            gradeQuizAnswer(q, pending)
          );
        }
        pendingAnswerRef.current = null;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [quizId, lessonId, submoduleId, moduleId]);

  // Reset selections when question changes.
  useEffect(() => {
    setSelectedAnswer(null);
    setSelectedAnswers([]);
    setHasSubmitted(false);
    setIsCorrect(false);
    setSelectedLeftItem(null);
    setSelectedRightIndex(null);
    setMatchedPairs({});
    setCompletedLeftItems([]);
    setCompletedRightIndices([]);
    setIncorrectLeftItems([]);
    setIncorrectRightIndices([]);
    setIsNavigating(false);
    answerTouchedRef.current = false;
  }, [currentQuestionIndex]);

  // After the reset above, restore any previously-saved selection for this
  // question (single/multiple choice) so navigating back or re-entering the quiz
  // keeps the user's answer. Matching questions are progressive and not restored.
  // Quiz questions are inline Sanity array items, so their stable id is `_key`
  // (they have no `_id`). Used as sanity_question_id for saved responses.
  const restoreQuestionId = questions?.[currentQuestionIndex]?._key;
  const restoreQuestionType = questions?.[currentQuestionIndex]?.question_type;
  useEffect(() => {
    if (!attemptId || !restoreQuestionId) return;
    let cancelled = false;
    getQuizResponses(attemptId).then(responses => {
      if (cancelled || answerTouchedRef.current) return;
      const saved = responses[restoreQuestionId];
      if (saved === undefined || saved === null) return;
      if (restoreQuestionType === 'multiple_choice_multiple') {
        setSelectedAnswers(Array.isArray(saved) ? saved : [saved]);
      } else if (restoreQuestionType !== 'matching') {
        setSelectedAnswer(
          Array.isArray(saved) ? String(saved[0] ?? '') : String(saved)
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [attemptId, restoreQuestionId, restoreQuestionType]);
  const totalQuestions = questions?.length || 0;
  // Get current quiz data
  const currentQuiz = quizzes?.find(q => q._id === quizId);
  const quizTitle = currentQuiz?.title;

  // Get current question (may be undefined during loading)
  const currentQuestion = questions?.[currentQuestionIndex];

  // Scramble right column items for matching questions
  // This hook must be called before any early returns to maintain hook order
  const scrambledRightItems = useMemo(() => {
    const question = questions?.[currentQuestionIndex];
    if (
      !question ||
      question.question_type !== 'matching' ||
      !question.matching_pairs ||
      question.matching_pairs.length === 0
    ) {
      return [];
    }
    // Extract right items and shuffle them
    const rightItems = question.matching_pairs.map(
      (pair: any) => pair.right_item
    );
    // Fisher-Yates shuffle algorithm
    const shuffled = [...rightItems];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }, [questions, currentQuestionIndex]);

  // Calculate progress for the progress bar
  const progress = calculateQuizProgress(
    submoduleData || null,
    lessonId || '',
    quizId || '',
    currentQuestionIndex + 1
  );

  // Track screen view
  const TRACKING_THROTTLE_MS = 500;
  const lastTrackedPageRef = useRef<string>('');
  const lastTrackedRef = useRef<number>(0);

  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      const pageKey = `${quizId}-${currentQuestionIndex}`;
      // Only track if: data is loaded, throttle passed, AND this is a different question than last tracked
      if (
        quizTitle &&
        now - lastTrackedRef.current > TRACKING_THROTTLE_MS &&
        lastTrackedPageRef.current !== pageKey
      ) {
        trackScreen(
          `Quiz: ${quizTitle} - Q${currentQuestionIndex + 1}/${totalQuestions}`
        );
        lastTrackedRef.current = now;
        lastTrackedPageRef.current = pageKey;
      }
      // Persist resume position so exit → re-enter lands back on this quiz question.
      if (lessonId && submoduleId && moduleId && quizId) {
        saveResumePosition(
          lessonId,
          submoduleId,
          moduleId,
          'quiz',
          currentQuestionIndex + 1,
          quizId,
          currentQuestionIndex + 1
        );
      }
    }, [
      quizTitle,
      quizId,
      lessonId,
      submoduleId,
      moduleId,
      currentQuestionIndex,
      totalQuestions,
      trackScreen,
    ])
  );

  if (isLoading || quizzesLoading || lessonLoading || submoduleLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>
          {t('learn.quiz.loadingQuestion')}
        </Text>
      </View>
    );
  }

  if (
    error ||
    quizzesError ||
    lessonError ||
    submoduleError ||
    !questions ||
    !lesson ||
    !hasLoadedContentItem(quizzes, quizId) ||
    !hasLoadedContentItem(submoduleData?.lessons, lessonId)
  ) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>
          {t('learn.quiz.errorLoadingQuestion')}
        </Text>
      </View>
    );
  }

  const isLastQuestion = currentQuestionIndex === totalQuestions - 1;

  const trackQuizCompletion = () => {
    if (moduleId && submoduleId && lessonId && quizId) {
      capture('quiz_completed', {
        module_id: moduleId,
        submodule_id: submoduleId,
        lesson_id: lessonId,
        quiz_id: quizId,
        quiz_title: currentQuiz?.title,
      });
    }
  };

  // Helper functions for sequential navigation
  const getCurrentLessonIndex = () => {
    if (!submoduleData?.lessons) return -1;
    return submoduleData.lessons.findIndex(l => l._id === lessonId);
  };

  const getNextLesson = () => {
    const currentIndex = getCurrentLessonIndex();
    if (currentIndex === -1 || !submoduleData?.lessons) return null;
    return submoduleData.lessons[currentIndex + 1] || null;
  };

  const getPreviousLesson = () => {
    const currentIndex = getCurrentLessonIndex();
    if (currentIndex === -1 || !submoduleData?.lessons) return null;
    return submoduleData.lessons[currentIndex - 1] || null;
  };

  // Canonical total-page count for user_lesson_progress. Uses the shared
  // helper so the denominator stays consistent with every other save site.
  const calculateTotalLessonPages = () => getLessonTotalPages(lesson, quizzes);

  if (!currentQuestion) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{t('learn.quiz.questionNotFound')}</Text>
      </View>
    );
  }

  // Persist the current selection against the in-progress attempt (fire-and-forget).
  // If the attempt isn't ready yet, stash the answer so the resolution effect can
  // flush it rather than dropping it.
  const persistSelection = (answer: string | string[]) => {
    if (!currentQuestion?._key) return;
    if (!attemptId) {
      pendingAnswerRef.current = answer;
      return;
    }
    submitQuizAnswer(
      attemptId,
      currentQuestion._key,
      currentQuestion.question_type,
      answer,
      gradeQuizAnswer(currentQuestion, answer)
    );
  };

  const handleAnswerSelect = (optionId: string) => {
    answerTouchedRef.current = true;
    if (currentQuestion.question_type === 'multiple_choice_multiple') {
      // Multiple selection logic
      const newAnswers = selectedAnswers.includes(optionId)
        ? selectedAnswers.filter(id => id !== optionId)
        : [...selectedAnswers, optionId];
      setSelectedAnswers(newAnswers);
      persistSelection(newAnswers);
    } else {
      // Single selection logic
      setSelectedAnswer(optionId);
      persistSelection(optionId);
    }
  };

  // Matching question handlers (right side by index so duplicate right values select only one)
  const handleMatchingItemSelect = (
    itemOrIndex: string | number,
    side: 'left' | 'right'
  ) => {
    if (side === 'left') {
      const item = itemOrIndex as string;
      if (completedLeftItems.includes(item)) return;
      setIncorrectLeftItems([]);
      setIncorrectRightIndices([]);
      setSelectedLeftItem(prev => (prev === item ? null : item));
    } else {
      const index = itemOrIndex as number;
      if (completedRightIndices.includes(index)) return;
      setIncorrectLeftItems([]);
      setIncorrectRightIndices([]);
      setSelectedRightIndex(prev => (prev === index ? null : index));
    }
  };

  const handleMatchingCheck = () => {
    if (selectedLeftItem === null || selectedRightIndex === null) return;
    const selectedRightItem = scrambledRightItems[selectedRightIndex];
    const correctMatch = currentQuestion.matching_pairs?.find(
      (pair: any) =>
        pair.left_item === selectedLeftItem &&
        pair.right_item === selectedRightItem
    );

    if (correctMatch) {
      setCompletedLeftItems(prev => [...prev, selectedLeftItem]);
      setCompletedRightIndices(prev => [...prev, selectedRightIndex]);
      setMatchedPairs(prev => ({
        ...prev,
        [selectedLeftItem]: selectedRightItem,
      }));
      setIncorrectLeftItems(prev => prev.filter(i => i !== selectedLeftItem));
      setIncorrectRightIndices(prev =>
        prev.filter(i => i !== selectedRightIndex)
      );
    } else {
      setIncorrectLeftItems(prev => [...prev, selectedLeftItem]);
      setIncorrectRightIndices(prev => [...prev, selectedRightIndex]);
    }

    setSelectedLeftItem(null);
    setSelectedRightIndex(null);
  };

  const handleNext = async () => {
    if (isNavigating) return;

    if (currentQuestion.question_type === 'matching') {
      // For matching questions, go directly to next question since all pairs are completed
      // No need for submission logic - proceed to navigation
      if (isLastQuestion) {
        setIsNavigating(true);
        // Quiz completed, check if there are more quizzes or go to next lesson
        const sortedQuizzes =
          quizzes?.sort((a, b) => a.order_number - b.order_number) || [];
        const currentQuizIndex = sortedQuizzes.findIndex(q => q._id === quizId);
        const nextQuiz = sortedQuizzes[currentQuizIndex + 1];

        // Track quiz completion
        trackQuizCompletion();
        // Close the attempt so a future visit starts fresh, not resumes old answers.
        if (attemptId) markQuizAttemptComplete(attemptId);

        if (nextQuiz) {
          // Go to next quiz
          router.push({
            pathname:
              '/(tabs)/Learn/modules/[moduleId]/[submoduleId]/lessons/[lessonId]/quizzes/[quizId]/pages/[questionNum]' as any,
            params: {
              moduleId,
              submoduleId,
              lessonId,
              quizId: nextQuiz._id,
              questionNum: '1',
            },
          });
        } else {
          // All quizzes completed, check if there are ending pages
          const totalEndingPages = lesson?.ending_pages?.length || 0;
          if (totalEndingPages > 0) {
            // Navigate to first ending page
            router.push({
              pathname:
                '/(tabs)/Learn/modules/[moduleId]/[submoduleId]/lessons/[lessonId]/ending/[pageNum]' as any,
              params: { moduleId, submoduleId, lessonId, pageNum: '1' },
            });
          } else {
            // No ending pages, save this lesson as completed
            const totalPages = calculateTotalLessonPages();
            const didSave = await saveLessonCompletion(
              lessonId || '',
              submoduleId || '',
              moduleId || '',
              totalPages
            );
            if (!didSave) {
              setIsNavigating(false);
              Alert.alert(t('common.somethingWentWrong'), t('common.tryAgain'));
              return;
            }

            // Check if this is the last lesson
            const currentIndex = getCurrentLessonIndex();
            const isLastLesson =
              currentIndex === (submoduleData?.lessons?.length || 0) - 1;

            if (isLastLesson) {
              router.dismissTo({
                pathname:
                  '/(tabs)/Learn/modules/[moduleId]/[submoduleId]' as any,
                params: { moduleId, submoduleId, justCompletedLearn: '1' },
              });
            } else {
              // Go to next lesson
              const nextLesson = getNextLesson();
              if (nextLesson) {
                router.push({
                  pathname:
                    '/(tabs)/Learn/modules/[moduleId]/[submoduleId]/lessons/[lessonId]/pages/[pageNum]' as any,
                  params: {
                    moduleId,
                    submoduleId,
                    lessonId: nextLesson._id,
                    pageNum: '1',
                  },
                });
              }
            }
          }
        }
      } else {
        setIsNavigating(true);
        // Go to next question in same quiz
        router.push({
          pathname:
            '/(tabs)/Learn/modules/[moduleId]/[submoduleId]/lessons/[lessonId]/quizzes/[quizId]/pages/[questionNum]' as any,
          params: {
            moduleId,
            submoduleId,
            lessonId,
            quizId,
            questionNum: (currentQuestionIndex + 2).toString(),
          },
        });
      }
    } else if (!hasSubmitted) {
      // First submission - check if answer is correct
      let isAnswerCorrect = false;

      if (currentQuestion.question_type === 'multiple_choice_multiple') {
        // For multiple choice multiple, check if all correct options are selected and no incorrect ones
        const correctOptions =
          currentQuestion.options?.filter((opt: any) => opt.is_correct) || [];
        const correctOptionIds = correctOptions.map((opt: any) => opt._key);

        // Check if all correct options are selected and no incorrect ones
        const hasAllCorrect = correctOptionIds.every((id: string) =>
          selectedAnswers.includes(id)
        );
        const hasNoIncorrect = selectedAnswers.every((id: string) =>
          correctOptionIds.includes(id)
        );

        isAnswerCorrect =
          hasAllCorrect && hasNoIncorrect && selectedAnswers.length > 0;
      } else {
        // Single choice logic
        const correctAnswerId =
          currentQuestion.correct_answer?.value?.[0] ||
          currentQuestion.correct_answer?.value;
        // `options` and a matching option are both optional in Sanity. Coerce
        // the resulting boolean | undefined to the boolean UI state contract.
        isAnswerCorrect = Boolean(
          selectedAnswer === correctAnswerId ||
            currentQuestion.options?.find(opt => opt._key === selectedAnswer)
              ?.is_correct
        );
      }

      setIsCorrect(isAnswerCorrect);
      setHasSubmitted(true);
    } else {
      // Already submitted and correct - proceed to next
      if (isLastQuestion) {
        setIsNavigating(true);
        // Quiz completed, check if there are more quizzes or go to next lesson
        const sortedQuizzes =
          quizzes?.sort((a, b) => a.order_number - b.order_number) || [];
        const currentQuizIndex = sortedQuizzes.findIndex(q => q._id === quizId);
        const nextQuiz = sortedQuizzes[currentQuizIndex + 1];

        // Track quiz completion
        trackQuizCompletion();
        // Close the attempt so a future visit starts fresh, not resumes old answers.
        if (attemptId) markQuizAttemptComplete(attemptId);

        if (nextQuiz) {
          // Go to next quiz
          router.push({
            pathname:
              '/(tabs)/Learn/modules/[moduleId]/[submoduleId]/lessons/[lessonId]/quizzes/[quizId]/pages/[questionNum]' as any,
            params: {
              moduleId,
              submoduleId,
              lessonId,
              quizId: nextQuiz._id,
              questionNum: '1',
            },
          });
        } else {
          // All quizzes completed, check if there are ending pages
          const totalEndingPages = lesson?.ending_pages?.length || 0;
          if (totalEndingPages > 0) {
            // Navigate to first ending page
            router.push({
              pathname:
                '/(tabs)/Learn/modules/[moduleId]/[submoduleId]/lessons/[lessonId]/ending/[pageNum]' as any,
              params: { moduleId, submoduleId, lessonId, pageNum: '1' },
            });
          } else {
            // No ending pages, save this lesson as completed
            const totalPages = calculateTotalLessonPages();
            const didSave = await saveLessonCompletion(
              lessonId || '',
              submoduleId || '',
              moduleId || '',
              totalPages
            );
            if (!didSave) {
              setIsNavigating(false);
              Alert.alert(t('common.somethingWentWrong'), t('common.tryAgain'));
              return;
            }

            // Check if this is the last lesson
            const currentIndex = getCurrentLessonIndex();
            const isLastLesson =
              currentIndex === (submoduleData?.lessons?.length || 0) - 1;

            if (isLastLesson) {
              router.dismissTo({
                pathname:
                  '/(tabs)/Learn/modules/[moduleId]/[submoduleId]' as any,
                params: { moduleId, submoduleId, justCompletedLearn: '1' },
              });
            } else {
              // Go to next lesson
              const nextLesson = getNextLesson();
              if (nextLesson) {
                router.push({
                  pathname:
                    '/(tabs)/Learn/modules/[moduleId]/[submoduleId]/lessons/[lessonId]/pages/[pageNum]' as any,
                  params: {
                    moduleId,
                    submoduleId,
                    lessonId: nextLesson._id,
                    pageNum: '1',
                  },
                });
              }
            }
          }
        }
      } else {
        setIsNavigating(true);
        // Go to next question
        router.push({
          pathname:
            '/(tabs)/Learn/modules/[moduleId]/[submoduleId]/lessons/[lessonId]/quizzes/[quizId]/pages/[questionNum]' as any,
          params: {
            moduleId,
            submoduleId,
            lessonId,
            quizId,
            questionNum: (currentQuestionIndex + 2).toString(),
          },
        });
      }
    }
  };

  const handleBack = () => {
    if (currentQuestionIndex > 0) {
      // Go to previous question
      router.push({
        pathname:
          '/(tabs)/Learn/modules/[moduleId]/[submoduleId]/lessons/[lessonId]/quizzes/[quizId]/pages/[questionNum]' as any,
        params: {
          moduleId,
          submoduleId,
          lessonId,
          quizId,
          questionNum: currentQuestionIndex.toString(),
        },
      });
    } else {
      // First question, go back to lesson
      router.push({
        pathname:
          '/(tabs)/Learn/modules/[moduleId]/[submoduleId]/lessons/[lessonId]/pages/[pageNum]' as any,
        params: { moduleId, submoduleId, lessonId, pageNum: '1' },
      });
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Progress Bar */}
      <SubmoduleProgressBar
        currentProgress={progress.currentPage}
        totalPages={progress.totalPages}
        submoduleTitle={submoduleData?.title || 'Submodule'}
        submoduleOrder={submoduleData?.order || 1}
        onClose={() => setShowExitModal(true)}
        colorHex={moduleData?.colorTheme?.hex}
      />

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Question Content */}
        <View style={styles.content}>
          {/* Quiz Title */}
          {currentQuiz?.title && (
            <Text style={styles.quizTitle}>{currentQuiz.title}</Text>
          )}

          <View style={styles.questionContainer}>
            <View style={styles.questionContent}>
              <RichTextRenderer
                blocks={currentQuestion.question_text || []}
                markDefs={currentQuestion.questionMarkDefs}
                styles={{
                  normal: {
                    fontSize: 18,
                    color: '#000',
                    lineHeight: 27,
                    textAlign: 'center',
                  },
                }}
              />
            </View>

            {currentQuestion.question_type === 'matching' ? (
              <View style={styles.matchingContainer}>
                <View style={styles.matchingGrid}>
                  {/* Left Column */}
                  <View style={styles.matchingColumn}>
                    {currentQuestion.matching_pairs?.map(
                      (pair: any, index: number) => (
                        <TouchableOpacity
                          key={`left-${index}`}
                          style={[
                            styles.matchingItem,
                            selectedLeftItem === pair.left_item &&
                              styles.matchingItemSelected,
                            completedLeftItems.includes(pair.left_item) &&
                              styles.matchingItemCompleted,
                            incorrectLeftItems.includes(pair.left_item) &&
                              styles.matchingItemIncorrect,
                          ]}
                          onPress={() =>
                            handleMatchingItemSelect(pair.left_item, 'left')
                          }
                          disabled={completedLeftItems.includes(pair.left_item)}
                        >
                          <Text style={styles.matchingItemText}>
                            {pair.left_item}
                          </Text>
                        </TouchableOpacity>
                      )
                    )}
                  </View>

                  {/* Right Column - Scrambled */}
                  <View style={styles.matchingColumn}>
                    {scrambledRightItems.map(
                      (rightItem: string, index: number) => (
                        <TouchableOpacity
                          key={`right-${index}-${rightItem}`}
                          style={[
                            styles.matchingItem,
                            selectedRightIndex === index &&
                              styles.matchingItemSelected,
                            completedRightIndices.includes(index) &&
                              styles.matchingItemCompleted,
                            incorrectRightIndices.includes(index) &&
                              styles.matchingItemIncorrect,
                          ]}
                          onPress={() =>
                            handleMatchingItemSelect(index, 'right')
                          }
                          disabled={completedRightIndices.includes(index)}
                        >
                          <Text style={styles.matchingItemText}>
                            {rightItem}
                          </Text>
                        </TouchableOpacity>
                      )
                    )}
                  </View>
                </View>

                {/* Check Button for Matching */}
                <TouchableOpacity
                  style={[
                    styles.matchingCheckButton,
                    (selectedLeftItem === null ||
                      selectedRightIndex === null) &&
                      styles.matchingCheckButtonDisabled,
                  ]}
                  onPress={handleMatchingCheck}
                  disabled={
                    selectedLeftItem === null || selectedRightIndex === null
                  }
                >
                  <Text
                    style={[
                      styles.matchingCheckButtonText,
                      (selectedLeftItem === null ||
                        selectedRightIndex === null) &&
                        styles.matchingCheckButtonTextDisabled,
                    ]}
                  >
                    {t('common.check')}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.optionsContainer}>
                {(currentQuestion.options || []).map((option: any) => {
                  const correctAnswerId =
                    currentQuestion.correct_answer?.value?.[0] ||
                    currentQuestion.correct_answer?.value;
                  const isSelected =
                    currentQuestion.question_type === 'multiple_choice_multiple'
                      ? selectedAnswers.includes(option._key)
                      : selectedAnswer === option._key;
                  const isCorrectOption =
                    option.is_correct || option._key === correctAnswerId;
                  const showFeedback = hasSubmitted;

                  let optionStyle = styles.optionButton;
                  let checkboxStyle = styles.checkbox;

                  // Normal selection behavior
                  if (isSelected) {
                    optionStyle = styles.optionButtonSelected;
                    checkboxStyle = styles.checkboxSelected;
                  }

                  // Add color feedback after check
                  if (showFeedback) {
                    if (isCorrectOption) {
                      // Correct answer - green border
                      optionStyle = styles.optionButtonCorrect;
                      checkboxStyle = styles.checkboxCorrect;
                    } else if (isSelected && !isCorrectOption) {
                      // Wrong selected answer - red border
                      optionStyle = styles.optionButtonIncorrect;
                      checkboxStyle = styles.checkboxIncorrect;
                    }
                  }

                  return (
                    <TouchableOpacity
                      key={option._key}
                      style={optionStyle}
                      onPress={() =>
                        !showFeedback && handleAnswerSelect(option._key)
                      }
                      disabled={showFeedback}
                    >
                      <View style={styles.optionRow}>
                        <View style={checkboxStyle}>
                          {isSelected && (
                            <Text style={styles.checkmark}>✓</Text>
                          )}
                        </View>
                        <View style={styles.optionContent}>
                          <RichTextRenderer
                            blocks={option.text || []}
                            markDefs={option.textMarkDefs}
                            styles={{
                              normal: {
                                ...styles.optionText,
                                marginBottom: 0,
                                marginTop: 0,
                              },
                            }}
                          />
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>

          {/* Answer box (if available and submitted) */}
          {currentQuestion.answer_box &&
            hasSubmitted &&
            currentQuestion.answer_box.showAfterSubmit && (
              <View style={styles.answerBoxContainer}>
                <RichTextRenderer
                  blocks={currentQuestion.answer_box.content || []}
                  markDefs={currentQuestion.answer_box.markDefs}
                  styles={{
                    normal: {
                      fontSize: 18,
                      lineHeight: 27,
                      fontWeight: '400',
                      color: '#3F3F3F',
                      marginBottom: 0,
                    },
                    bullet: {
                      fontSize: 18,
                      lineHeight: 27,
                      fontWeight: '400',
                      color: '#3F3F3F',
                      marginBottom: 0,
                    },
                    number: {
                      fontSize: 18,
                      lineHeight: 27,
                      fontWeight: '400',
                      color: '#3F3F3F',
                      marginBottom: 0,
                    },
                    strong: {
                      fontSize: 18,
                      lineHeight: 27,
                      fontWeight: '600',
                      color: '#3F3F3F',
                    },
                  }}
                />
              </View>
            )}
        </View>
      </ScrollView>

      {/* Footer Buttons - anchored at bottom */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backButtonText}>{t('common.back')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.checkButton,
            {
              backgroundColor: (
                currentQuestion.question_type === 'matching'
                  ? completedLeftItems.length !==
                    (currentQuestion.matching_pairs?.length || 0)
                  : currentQuestion.question_type === 'multiple_choice_multiple'
                    ? selectedAnswers.length === 0
                    : !selectedAnswer
              )
                ? '#F3F4F6'
                : moduleData?.colorTheme?.hex || '#575757',
            },
          ]}
          onPress={handleNext}
          disabled={
            currentQuestion.question_type === 'matching'
              ? completedLeftItems.length !==
                (currentQuestion.matching_pairs?.length || 0)
              : currentQuestion.question_type === 'multiple_choice_multiple'
                ? selectedAnswers.length === 0
                : !selectedAnswer
          }
        >
          <Text
            style={[
              styles.checkButtonText,
              (currentQuestion.question_type === 'matching'
                ? completedLeftItems.length !==
                  (currentQuestion.matching_pairs?.length || 0)
                : currentQuestion.question_type === 'multiple_choice_multiple'
                  ? selectedAnswers.length === 0
                  : !selectedAnswer) && styles.checkButtonTextDisabled,
            ]}
          >
            {currentQuestion.question_type === 'matching'
              ? t('common.next')
              : !hasSubmitted
                ? t('common.check')
                : t('common.next')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Exit modal */}
      <Modal
        visible={showExitModal}
        transparent
        animationType='fade'
        onRequestClose={() => setShowExitModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {t('learn.lesson.exitQuizTitle')}
            </Text>
            <Text style={styles.modalDesc}>
              {t('learn.lesson.exitBody1')}
              {'\n'}
              {t('learn.lesson.exitBody2')}
            </Text>

            <TouchableOpacity
              style={styles.modalPrimaryBtn}
              onPress={() => {
                setShowExitModal(false);
                router.push({
                  pathname:
                    '/(tabs)/Learn/modules/[moduleId]/[submoduleId]' as any,
                  params: { moduleId, submoduleId },
                });
              }}
            >
              <Text style={styles.modalPrimaryBtnText}>
                {t('learn.lesson.exitSave')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalSecondaryBtn}
              onPress={() => setShowExitModal(false)}
            >
              <Text style={styles.modalSecondaryBtnText}>
                {t('learn.lesson.exitQuizContinue')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  loadingText: {
    fontSize: 16,
    color: '#6B7280',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    color: '#DC2626',
    textAlign: 'center',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  closeButton: {
    fontSize: 18,
    color: '#000',
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#000',
    flex: 1,
    textAlign: 'center',
    marginRight: 18, // Compensate for close button width
  },
  progressBar: {
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#000',
    borderRadius: 2,
  },
  questionCounterContainer: {
    alignItems: 'center',
    marginTop: 10,
    paddingHorizontal: 20,
  },
  questionCounter: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
  },
  content: {
    padding: 20,
    flex: 1,
  },
  quizTitle: {
    fontSize: 32,
    fontWeight: '700',
    color: '#000',
    marginBottom: 12,
    lineHeight: 38,
    textAlign: 'center',
  },
  questionContainer: {
    gap: 15,
  },
  questionContent: {
    marginBottom: 24,
    alignItems: 'center',
  },
  questionText: {
    fontSize: 25,
    color: '#000',
    lineHeight: 30,
  },
  optionsContainer: {
    gap: 17,
  },
  optionButton: {
    borderWidth: 1,
    borderColor: '#DCDCDC',
    borderRadius: 8,
    paddingVertical: 20,
    paddingHorizontal: 24,
  },
  optionButtonSelected: {
    borderWidth: 1,
    borderColor: 'black',
    borderRadius: 8,
    paddingVertical: 20,
    paddingHorizontal: 24,
    backgroundColor: '#F3F4F6',
  },
  optionButtonCorrect: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 20,
    paddingHorizontal: 24,
    borderColor: '#10B981',
    backgroundColor: '#F3F4F6',
  },
  optionButtonIncorrect: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderColor: '#EF4444',
    backgroundColor: '#F3F4F6',
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginLeft: 5,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 4,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 0,
  },
  checkboxSelected: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: 'black',
    borderRadius: 4,
    backgroundColor: 'black',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 0,
  },
  checkboxCorrect: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderColor: '#10B981',
    backgroundColor: '#10B981',
    marginTop: 0,
  },
  checkboxIncorrect: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    borderColor: '#EF4444',
    backgroundColor: '#EF4444',
    marginTop: 0,
  },
  checkmark: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  optionContent: {
    flex: 1,
    minHeight: 20,
  },
  optionText: {
    fontSize: 18,
    color: '#374151',
    lineHeight: 27,
    fontWeight: '700',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
    paddingBottom: 50,
    backgroundColor: '#fff',
    gap: 12,
  },
  backButton: {
    backgroundColor: '#E5E7EB',
    paddingVertical: 14,
    paddingHorizontal: 70,
    borderRadius: 8,
    alignItems: 'center',
  },
  backButtonText: {
    color: '#6B7280',
    fontSize: 16,
    fontWeight: '600',
  },
  checkButton: {
    backgroundColor: '#575757',
    paddingVertical: 14,
    paddingHorizontal: 70,
    borderRadius: 8,
    alignItems: 'center',
  },
  checkButtonDisabled: {
    backgroundColor: '#F3F4F6',
  },
  checkButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  checkButtonTextDisabled: {
    color: '#9CA3AF',
  },
  boldText: {
    fontWeight: '700',
  },
  italicText: {
    fontStyle: 'italic',
  },

  // Matching question styles
  matchingContainer: {
    marginTop: 20,
  },
  matchingGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 20,
  },
  matchingColumn: {
    flex: 1,
    gap: 12,
  },
  matchingItem: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#DCDCDC',
    borderRadius: 8,
    padding: 16,
    minWidth: 170,
    minHeight: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchingItemSelected: {
    borderColor: '#575757',
    backgroundColor: '#F3F4F6',
  },
  matchingItemCompleted: {
    borderColor: '#10B981',
    backgroundColor: '#ECFDF5',
    opacity: 0.7,
  },
  matchingItemIncorrect: {
    borderColor: '#EF4444',
    backgroundColor: '#FEF2F2',
  },
  matchingItemText: {
    fontSize: 14,
    color: '#374151',
    textAlign: 'center',
    fontWeight: '500',
  },
  matchingCheckButton: {
    backgroundColor: '#575757',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
    alignSelf: 'center',
  },
  matchingCheckButtonDisabled: {
    backgroundColor: '#F3F4F6',
  },
  matchingCheckButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  matchingCheckButtonTextDisabled: {
    color: '#9CA3AF',
  },
  answerBoxContainer: {
    backgroundColor: 'transparent',
    borderLeftWidth: 5,
    borderLeftColor: '#3F3F3F',
    paddingLeft: 15,
    paddingRight: 0,
    paddingVertical: 0,
    alignSelf: 'center',
    width: 353,
    maxWidth: '100%',
    minHeight: 80,
    marginTop: 20,
    marginBottom: 30,
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#000',
    marginBottom: 12,
    textAlign: 'center',
  },
  modalDesc: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 24,
  },
  modalPrimaryBtn: {
    width: '100%',
    backgroundColor: '#575757',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  modalPrimaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  modalSecondaryBtn: {
    width: '100%',
    backgroundColor: '#E5E7EB',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalSecondaryBtnText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '600',
  },
});
