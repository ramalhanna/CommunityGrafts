import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSanityTask, useSanityTasks } from '@/hooks/sanity/useSanityTasks';
import { useSanityModule } from '@/hooks/sanity/useSanityModules';
import { useSanitySubmoduleWithLessons } from '@/hooks/sanity/useSanitySubmodules';
import RichTextRenderer from '@/components/sanity/RichTextRenderer';
import SubmoduleProgressBar from '@/components/learn/SubmoduleProgressBar';
import { useTaskProgress } from '@/hooks/progress/useTaskProgress';
import { useTranslation } from 'react-i18next';
import { hasLoadedContentItem } from '@/utils/learnCompletionNavigation';

export default function TaskPageScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { moduleId, submoduleId, taskId } = useLocalSearchParams<{
    moduleId: string;
    submoduleId: string;
    taskId: string;
  }>();
  const [showExitModal, setShowExitModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { data: task, isLoading } = useSanityTask(taskId || '');
  const {
    data: tasks,
    isLoading: tasksLoading,
    error: tasksError,
  } = useSanityTasks(submoduleId || '');
  const { data: moduleData } = useSanityModule(moduleId || '');
  const { data: submoduleData } = useSanitySubmoduleWithLessons(
    submoduleId || ''
  );
  const { getTaskProgress, startTask, completeTask, updateTaskLastAccessed } =
    useTaskProgress();

  const sortedTasks = useMemo(
    () =>
      [...(tasks || [])].sort((a, b) => (a.ordering ?? 0) - (b.ordering ?? 0)),
    [tasks]
  );
  const currentIndex = useMemo(
    () => sortedTasks.findIndex(task => task._id === taskId),
    [sortedTasks, taskId]
  );
  const totalTasks = sortedTasks.length;
  const prevTask = currentIndex > 0 ? sortedTasks[currentIndex - 1] : null;
  const nextTask =
    currentIndex >= 0 && currentIndex < totalTasks - 1
      ? sortedTasks[currentIndex + 1]
      : null;

  const progress = {
    currentPage: currentIndex >= 0 ? currentIndex + 1 : 1,
    totalPages: totalTasks || 1,
    progressPercentage:
      totalTasks > 0 && currentIndex >= 0
        ? ((currentIndex + 1) / totalTasks) * 100
        : 100,
  };

  useFocusEffect(
    useCallback(() => {
      if (!taskId || !moduleId || !submoduleId) return;
      getTaskProgress(taskId).then(existing => {
        if (existing) {
          updateTaskLastAccessed(taskId);
        } else {
          startTask(taskId, submoduleId, moduleId);
        }
      });
    }, [
      taskId,
      moduleId,
      submoduleId,
      getTaskProgress,
      startTask,
      updateTaskLastAccessed,
    ])
  );

  const goToSubmoduleIndex = (justCompletedTasks = false) => {
    const destination = {
      pathname: '/(tabs)/Learn/modules/[moduleId]/[submoduleId]' as any,
      params: justCompletedTasks
        ? { moduleId, submoduleId, justCompletedTasks: '1' }
        : { moduleId, submoduleId },
    };

    if (justCompletedTasks) {
      router.dismissTo(destination);
    } else {
      router.push(destination);
    }
  };

  const handleSaveAndLeave = () => {
    setShowExitModal(false);
    goToSubmoduleIndex();
  };

  const handleContinue = () => {
    setShowExitModal(false);
  };

  const handleBack = () => {
    if (prevTask) {
      router.push({
        pathname:
          '/(tabs)/Learn/modules/[moduleId]/[submoduleId]/tasks/[taskId]' as any,
        params: { moduleId, submoduleId, taskId: prevTask._id },
      });
    } else {
      goToSubmoduleIndex();
    }
  };

  const handleNext = async () => {
    if (!taskId) return;
    setIsSaving(true);
    try {
      const didSave = await completeTask(taskId);
      if (!didSave) {
        Alert.alert(t('common.somethingWentWrong'), t('common.tryAgain'));
        return;
      }
      if (nextTask) {
        router.push({
          pathname:
            '/(tabs)/Learn/modules/[moduleId]/[submoduleId]/tasks/[taskId]' as any,
          params: { moduleId, submoduleId, taskId: nextTask._id },
        });
      } else {
        goToSubmoduleIndex(true);
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading || tasksLoading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loading}>
          <ActivityIndicator
            size='large'
            color={moduleData?.colorTheme?.hex || '#575757'}
          />
          <Text style={styles.loadingText}>{t('common.loading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!task || tasksError || !hasLoadedContentItem(tasks, taskId)) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loading}>
          <Text style={styles.errorText}>{t('learn.tasks.taskNotFound')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const content = task.content || [];

  return (
    <SafeAreaView style={styles.safe}>
      <SubmoduleProgressBar
        currentProgress={progress.currentPage}
        totalPages={progress.totalPages}
        submoduleTitle={submoduleData?.title || t('learn.tasks.taskFallback')}
        submoduleOrder={submoduleData?.order ?? 1}
        onClose={() => setShowExitModal(true)}
        colorHex={moduleData?.colorTheme?.hex}
      />

      <ScrollView
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.pageTitle}>{task.title}</Text>

        <View style={styles.content}>
          <RichTextRenderer
            blocks={content}
            markDefs={task.markDefs}
            styles={{ normal: styles.contentText }}
          />
        </View>
      </ScrollView>

      <View style={styles.navigationContainer}>
        <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
          <Text style={styles.backBtnText}>{t('common.back')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.nextBtn,
            { backgroundColor: moduleData?.colorTheme?.hex || '#575757' },
            isSaving && styles.nextBtnDisabled,
          ]}
          onPress={handleNext}
          disabled={isSaving}
        >
          <Text style={styles.nextBtnText}>
            {isSaving
              ? t('learn.tasks.savingProgress')
              : nextTask
                ? t('common.next')
                : t('learn.pathwayCard.done')}
          </Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={showExitModal}
        transparent
        animationType='fade'
        onRequestClose={() => setShowExitModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{t('learn.tasks.leaveTitle')}</Text>
            <Text style={styles.modalDesc}>{t('learn.tasks.leaveBody')}</Text>

            <TouchableOpacity
              style={styles.modalPrimaryBtn}
              onPress={handleSaveAndLeave}
            >
              <Text style={styles.modalPrimaryBtnText}>
                {t('learn.lesson.exitSave')}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalSecondaryBtn}
              onPress={handleContinue}
            >
              <Text style={styles.modalSecondaryBtnText}>
                {t('common.continue')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { paddingHorizontal: 23, paddingBottom: 100 },
  pageTitle: {
    fontSize: 32,
    fontWeight: '600',
    color: '#000',
    marginBottom: 20,
    lineHeight: 40,
    textAlign: 'center',
    marginTop: 20,
  },
  content: {
    gap: 20,
    marginBottom: 30,
  },
  contentText: {
    fontWeight: '400',
    color: '#424242',
    marginBottom: 15,
    fontSize: 18,
    lineHeight: 27,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: { marginTop: 12, fontSize: 16, color: '#6B7280' },
  errorText: { fontSize: 16, color: '#EF4444', textAlign: 'center' },

  navigationContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 23,
    paddingVertical: 20,
    paddingBottom: 50,
    backgroundColor: '#fff',
    gap: 12,
  },
  backBtn: {
    backgroundColor: '#E5E7EB',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    alignItems: 'center',
    flex: 1,
  },
  backBtnText: { color: '#374151', fontSize: 16, fontWeight: '600' },
  nextBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
    alignItems: 'center',
    flex: 1,
  },
  nextBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  nextBtnDisabled: {
    opacity: 0.7,
  },

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
    fontSize: 16,
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
