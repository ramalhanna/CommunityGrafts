import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Modal,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Feather } from '@expo/vector-icons';
import { useSanitySubmoduleWithLessons } from '@/hooks/sanity/useSanitySubmodules';
import { useSanityModule } from '@/hooks/sanity/useSanityModules';
import { SubmoduleIntroSection } from '@/types/learn';
import RichTextRenderer from '@/components/sanity/RichTextRenderer';
import SubmoduleProgressBar from '@/components/learn/SubmoduleProgressBar';
import {
  calculateIntroProgress,
  getLessonTotalPages,
} from '@/utils/submoduleProgress';
import { useLessonProgress } from '@/hooks/progress/useLessonProgress';

const getSanityImageUrl = (assetRef: string | undefined): string | null => {
  if (!assetRef) return null;
  const match = assetRef.match(/image-([a-f0-9]+)-([\w]+)/i);
  if (!match) return null;
  const [, imageId, ext] = match;
  return `https://cdn.sanity.io/images/fercgabp/production/${imageId}.${ext}`;
};

export default function SubmoduleIntroScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { moduleId, submoduleId, pageNum } = useLocalSearchParams<{
    moduleId: string;
    submoduleId: string;
    pageNum: string;
  }>();
  const [showExitModal, setShowExitModal] = useState(false);
  const { saveCurrentPage } = useLessonProgress();

  const currentPage = parseInt(pageNum || '1');
  const { data: submoduleData, isLoading: loadingIntro } =
    useSanitySubmoduleWithLessons(submoduleId || '');
  const { data: moduleData } = useSanityModule(moduleId || '');

  // Get intro pages from Sanity data and sort by order (1-indexed)
  const introPages = (submoduleData?.intro_pages || []).sort(
    (a: any, b: any) => a.order - b.order
  );
  const totalPages = introPages.length;
  const introData = introPages[currentPage - 1];

  // Calculate progress for the progress bar
  const progress = calculateIntroProgress(submoduleData || null, currentPage);

  const handleSaveAndLeave = () => {
    setShowExitModal(false);
    router.push({
      pathname: '/(tabs)/Learn/modules/[moduleId]/[submoduleId]' as any,
      params: { moduleId, submoduleId },
    });
  };

  const handleContinue = () => {
    setShowExitModal(false);
  };

  const handleBack = () => {
    if (currentPage > 1) {
      router.push({
        pathname:
          '/(tabs)/Learn/modules/[moduleId]/[submoduleId]/intro/[pageNum]' as any,
        params: {
          moduleId,
          submoduleId,
          pageNum: (currentPage - 1).toString(),
        },
      });
    }
  };

  const handleNext = () => {
    const firstLesson = submoduleData?.lessons?.[0];

    if (currentPage < (totalPages || 1)) {
      // Save current intro page position against the first lesson so
      // getLearnHref can resume here with current_page_type: 'intro'.
      // total_pages must be the first lesson's full denominator (lesson +
      // activity + quiz + ending pages), not the intro page count — otherwise
      // the home carousel's progress bar for this lesson will divide by the
      // wrong total.
      if (firstLesson?._id && moduleId && submoduleId) {
        const lessonTotal = getLessonTotalPages(firstLesson) || 1;
        saveCurrentPage(
          firstLesson._id,
          submoduleId,
          moduleId,
          'intro',
          currentPage,
          lessonTotal
        );
      }

      router.push({
        pathname:
          '/(tabs)/Learn/modules/[moduleId]/[submoduleId]/intro/[pageNum]' as any,
        params: {
          moduleId,
          submoduleId,
          pageNum: (currentPage + 1).toString(),
        },
      });
    } else {
      // Last intro page done — advance to the first lesson page
      if (firstLesson) {
        router.push({
          pathname:
            '/(tabs)/Learn/modules/[moduleId]/[submoduleId]/lessons/[lessonId]' as any,
          params: { moduleId, submoduleId, lessonId: firstLesson._id },
        });
      } else {
        router.push({
          pathname: '/(tabs)/Learn/modules/[moduleId]/[submoduleId]' as any,
          params: { moduleId, submoduleId },
        });
      }
    }
  };

  // Helper function to render Sanity block content
  const renderBlockContent = (blocks: any[]) => {
    if (!blocks || !Array.isArray(blocks)) return null;

    return blocks
      .map((block, index) => {
        if (block._type === 'block') {
          // Render text blocks with proper formatting
          return (
            <Text key={block._key || index} style={styles.textContent}>
              {block.children?.map((child: any, childIndex: number) => {
                if (child.marks?.includes('strong')) {
                  return (
                    <Text key={childIndex} style={styles.boldText}>
                      {child.text}
                    </Text>
                  );
                }
                return child.text || '';
              })}
            </Text>
          );
        } else if (block._type === 'image') {
          // Render images
          const imageUrl = getSanityImageUrl(block.asset?._ref);

          return (
            <View key={block._key || index} style={styles.imageSection}>
              {imageUrl ? (
                <Image
                  source={{ uri: imageUrl }}
                  style={styles.image}
                  contentFit='cover'
                  cachePolicy='memory-disk'
                />
              ) : (
                <View style={styles.imagePlaceholder}>
                  <Text style={styles.imagePlaceholderText}>
                    {t('learn.lesson.imagePlaceholder')}
                  </Text>
                </View>
              )}
            </View>
          );
        }
        return null;
      })
      .filter(Boolean); // Remove null values
  };

  const renderSection = (section: SubmoduleIntroSection, index: number) => {
    switch (section.type) {
      case 'text':
        return (
          <View key={index} style={styles.textSection}>
            <Text style={styles.textContent}>
              {section.content?.map((textContent, textIndex) => (
                <Text
                  key={textIndex}
                  style={[textContent.bold && styles.boldText]}
                >
                  {textContent.text}
                </Text>
              ))}
            </Text>
          </View>
        );

      case 'list':
        return (
          <View key={index} style={styles.listSection}>
            {section.title && (
              <Text style={styles.listTitle}>{section.title}</Text>
            )}
            {section.items?.map((item, itemIndex) => {
              if (typeof item === 'string') {
                return (
                  <Text key={itemIndex} style={styles.listItem}>
                    • {item}
                  </Text>
                );
              } else if (item.term && item.definition) {
                // Terms and definitions format
                return (
                  <View key={itemIndex} style={styles.definitionItem}>
                    <View style={styles.bulletPoint} />
                    <Text style={styles.definitionText}>
                      <Text style={styles.term}>{item.term}</Text>
                      <Text style={styles.separator}> = </Text>
                      <Text style={styles.definition}>{item.definition}</Text>
                    </Text>
                  </View>
                );
              } else {
                return (
                  <View key={itemIndex} style={styles.definitionItem}>
                    <Text style={styles.term}>{item.term}</Text>
                    <Text style={styles.definition}>{item.definition}</Text>
                  </View>
                );
              }
            })}
          </View>
        );

      case 'image':
        return (
          <View key={index} style={styles.imageSection}>
            {section.url ? (
              <Image
                source={{ uri: section.url }}
                style={styles.image}
                contentFit='cover'
                cachePolicy='memory-disk'
              />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Text style={styles.imagePlaceholderText}>
                  {section.alt || t('learn.lesson.imagePlaceholder')}
                </Text>
              </View>
            )}
          </View>
        );

      case 'image_placeholder':
        return (
          <View key={index} style={styles.imageSection}>
            <View style={styles.imagePlaceholder}>
              <Text style={styles.imagePlaceholderText}>
                {section.alt || t('learn.lesson.imagePlaceholder')}
              </Text>
            </View>
          </View>
        );

      default:
        return null;
    }
  };

  if (loadingIntro) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loading}>
          <Text>{t('learn.lesson.loadingIntro')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!introData) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loading}>
          <Text>{t('learn.lesson.errorLoadingIntro')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
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
        contentContainerStyle={styles.container}
        showsVerticalScrollIndicator={false}
      >
        {/* Title */}
        <Text style={styles.title}>{introData?.title}</Text>

        {/* Content sections */}
        <View style={styles.content}>
          <RichTextRenderer
            blocks={introData?.content}
            markDefs={introData?.markDefs}
          />
        </View>
      </ScrollView>

      {/* Navigation buttons - anchored at bottom */}
      <View style={styles.buttonContainer}>
        {currentPage > 1 && (
          <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
            <Text style={styles.backBtnText}>{t('common.back')}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[
            styles.nextBtn,
            { backgroundColor: moduleData?.colorTheme?.hex || '#1A1919' },
          ]}
          onPress={handleNext}
        >
          <Text style={styles.nextBtnText}>{t('common.next')}</Text>
        </TouchableOpacity>
      </View>

      {/* Exit Confirmation Modal */}
      <Modal
        visible={showExitModal}
        transparent
        animationType='fade'
        onRequestClose={() => setShowExitModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {t('learn.lesson.exitTitle')}
            </Text>
            <Text style={styles.modalDesc}>
              {t('learn.lesson.exitBody1')}{'\n'}
              {t('learn.lesson.exitBody2')}
            </Text>

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
              <Text style={styles.modalSecondaryBtnText}>{t('learn.lesson.exitContinue')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#fff' },
  container: { paddingHorizontal: 20, paddingBottom: 100 },

  // Page indicator
  pageIndicatorContainer: {
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 12,
  },
  pageIndicator: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
  },

  title: {
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

  // Text sections
  textSection: {
    gap: 8,
  },
  textContent: {
    fontSize: 16,
    color: '#374151',
    lineHeight: 24,
  },
  boldText: {
    fontWeight: '700',
  },

  // List sections
  listSection: {
    gap: 12,
  },
  listTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#000',
    marginBottom: 8,
  },
  listItem: {
    fontSize: 16,
    color: '#374151',
    lineHeight: 24,
    marginLeft: 8,
  },

  // Definition items
  definitionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  bulletPoint: {
    width: 6,
    height: 6,
    backgroundColor: '#000',
    borderRadius: 3,
    marginTop: 8,
    marginRight: 8,
  },
  definitionText: {
    flex: 1,
    fontSize: 16,
    lineHeight: 24,
  },
  term: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
  },
  separator: {
    fontSize: 16,
    color: '#000',
  },
  definition: {
    fontSize: 16,
    color: '#374151',
    lineHeight: 24,
  },

  // Image sections
  imageSection: {
    alignItems: 'center',
    marginVertical: 10,
  },
  image: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    resizeMode: 'cover',
  },
  imagePlaceholder: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePlaceholderText: {
    fontSize: 16,
    color: '#6B7280',
    textAlign: 'center',
  },

  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Button container and buttons
  buttonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 20,
    paddingBottom: 50,
    backgroundColor: '#fff',
    gap: 12,
  },
  backBtn: {
    flex: 1,
    backgroundColor: '#E5E7EB',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  backBtnText: {
    color: '#374151',
    fontSize: 16,
    fontWeight: '600',
  },
  nextBtn: {
    flex: 1,
    backgroundColor: '#575757',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  nextBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },

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
