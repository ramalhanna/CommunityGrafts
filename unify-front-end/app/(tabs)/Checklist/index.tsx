import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Alert,
  Dimensions,
  View,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
} from 'react-native';
import { TouchableOpacity as GHTouchableOpacity } from 'react-native-gesture-handler';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useTabBarHeight } from '@/hooks/useTabBarHeight';
import * as Haptics from 'expo-haptics';
import ConfettiCannon from 'react-native-confetti-cannon';
import { useTranslation } from 'react-i18next';
import DraggableFlatList, {
  RenderItemParams,
  ScaleDecorator,
} from 'react-native-draggable-flatlist';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAnalytics } from '@/utils/analytics';
import { useUserStage } from '@/hooks/onboarding/useUserStage';
import { useChecklistTasks } from '@/hooks/checklist/useChecklistTasks';
import { getOnboardingProfile } from '@/services/onboarding/getOnboardingProfile';
import { setChecklistItemCompletion } from '@/services/checklist/setChecklistItemCompletion';
import {
  deleteCustomChecklistTask,
  setCustomChecklistTaskCompletion,
} from '@/services/checklist/customChecklistTasks';
import { upsertChecklistTaskOrder } from '@/services/checklist/checklistTaskOrder';
import { ChecklistItem } from '@/components/checklist/ChecklistItem';
import { ChecklistSectionHeader } from '@/components/checklist/ChecklistSectionHeader';
import { TaskDetailModal } from '@/components/checklist/TaskDetailModal';
import { supabase } from '@/lib/supabase';
import {
  ChecklistLinkTabSlug,
  Priority,
  UserTaskWithDetails,
} from '@/types/checklist';
import {
  CHECKLIST_PRIORITY_ORDER,
  normalizeChecklistPriority,
  getChecklistTaskOrderKey,
  replacePriorityBucket,
} from '@/utils/checklistOrder';
import { PRIORITY_CONFIG } from '@/constants/ChecklistPriority';
import { useHapticsPreference } from '@/context/HapticsContext';
import TabHeader from '@/components/home/HomeHeader';
import LoadingScreen from '@/components/LoadingScreen';

/**
 * Map checklist tab slug to (tabs) route for "Learn how" navigation.
 * Paths must match tab bar in app/(tabs)/_layout.tsx (Tabs.Screen name):
 * - Social, Gather (Community), companion, Checklist, Learn.
 */
const TAB_SLUG_TO_ROUTE: Record<ChecklistLinkTabSlug, string> = {
  home: '/(tabs)/Social',
  community: '/(tabs)/Gather',
  companion: '/(tabs)/companion',
  checklist: '/(tabs)/Checklist',
  learn: '/(tabs)/Learn',
};

/** Optional aliases if Sanity uses different slug values (e.g. gather → community) */
const TAB_SLUG_ALIASES: Record<string, ChecklistLinkTabSlug> = {
  gather: 'community',
  index: 'home',
  social: 'home',
};

const STAGE_KEYS: Record<number, string> = {
  0: 'checklist.stage.0',
  1: 'checklist.stage.1',
  2: 'checklist.stage.2',
  3: 'checklist.stage.3',
  4: 'checklist.stage.4',
};

const PERSONA_KEYS: Record<string, string> = {
  international_student: 'checklist.persona.international_student',
  refugee: 'checklist.persona.refugee',
  protected_person: 'checklist.persona.protected_person',
  skilled_worker: 'checklist.persona.skilled_worker',
  immigrant: 'checklist.persona.immigrant',
  pr: 'checklist.persona.pr',
};

type ChecklistRow =
  | {
      type: 'header';
      key: string;
      priority: Priority;
      completedCount: number;
      totalCount: number;
    }
  | {
      type: 'task';
      key: string;
      task: UserTaskWithDetails;
      isLastInSection: boolean;
    };

function buildRows(tasks: UserTaskWithDetails[]): ChecklistRow[] {
  const byPriority: Record<Priority, UserTaskWithDetails[]> = {
    'Do now': [],
    'Do soon': [],
    'Explore and connect': [],
    'Explore & connect': [],
    'Optional / later': [],
  };
  for (const t of tasks) {
    const p = normalizeChecklistPriority(t.task.priority);
    byPriority[p].push(t);
  }

  const rows: ChecklistRow[] = [];
  for (const priority of CHECKLIST_PRIORITY_ORDER) {
    const tasksInP = byPriority[priority] ?? [];
    rows.push({
      type: 'header',
      key: `header:${priority}`,
      priority,
      completedCount: tasksInP.filter(t => t.completed).length,
      totalCount: tasksInP.length,
    });
    tasksInP.forEach((task, idx) => {
      rows.push({
        type: 'task',
        key: getChecklistTaskOrderKey(task),
        task,
        isLastInSection: idx === tasksInP.length - 1,
      });
    });
  }
  return rows;
}

/** Walk back from the given index to find which priority section it belongs to. */
function findSectionAtIndex(
  rows: ChecklistRow[],
  index: number
): Priority | null {
  for (let i = Math.min(index, rows.length - 1); i >= 0; i--) {
    const r = rows[i];
    if (r?.type === 'header') return r.priority;
  }
  return null;
}

/** Extract just the tasks under the given priority section, in their current order. */
function extractTasksInSection(
  rows: ChecklistRow[],
  priority: Priority
): UserTaskWithDetails[] {
  const out: UserTaskWithDetails[] = [];
  let inSection = false;
  for (const r of rows) {
    if (r.type === 'header') {
      inSection = r.priority === priority;
      continue;
    }
    if (inSection) out.push(r.task);
  }
  return out;
}

export default function ChecklistScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const {
    trackScreen,
    trackChecklistTaskCompleted,
    trackChecklistTaskUncompleted,
    trackChecklistCustomTaskDeleted,
  } = useAnalytics();
  const {
    currentStage,
    stageChanged,
    isLoading: stageLoading,
  } = useUserStage();
  const [persona, setPersona] = useState<string | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [selectedTask, setSelectedTask] = useState<UserTaskWithDetails | null>(
    null
  );
  const [modalVisible, setModalVisible] = useState(false);
  const [confettiKey, setConfettiKey] = useState<number | null>(null);
  const confettiTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confettiTimeoutRef.current) {
        clearTimeout(confettiTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const fetchPersona = async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          const profile = await getOnboardingProfile(user.id);
          setPersona(profile?.persona || null);
        }
      } catch (error) {
        console.error('Error fetching persona:', error);
      } finally {
        setIsLoadingProfile(false);
      }
    };

    fetchPersona();
  }, []);

  const {
    tasks,
    isLoading: tasksLoading,
    refetch,
    setTasks,
  } = useChecklistTasks({
    currentStage,
    stageChanged,
    persona,
  });

  // Refetch when Checklist tab is focused so new/updated Sanity tasks show up
  useFocusEffect(
    useCallback(() => {
      trackScreen('Checklist');
      if (currentStage !== null && persona) {
        refetch();
      }
    }, [currentStage, persona, refetch, trackScreen])
  );

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(task => task.completed).length;
  const progressPercent = totalTasks > 0 ? completedTasks / totalTasks : 0;

  const isLoading = stageLoading || isLoadingProfile || tasksLoading;

  const { hapticsEnabled } = useHapticsPreference();
  const tabBarHeight = useTabBarHeight();

  const rows = useMemo(() => buildRows(tasks), [tasks]);

  const handleTaskPress = useCallback((task: UserTaskWithDetails) => {
    setSelectedTask(task);
    setModalVisible(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setModalVisible(false);
    setSelectedTask(null);
  }, []);

  const handleDragStart = useCallback(() => {
    if (hapticsEnabled) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
  }, [hapticsEnabled]);

  const handleReorder = useCallback(
    async (priority: Priority, reorderedBucket: UserTaskWithDetails[]) => {
      setTasks(prev => replacePriorityBucket(prev, priority, reorderedBucket));

      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Missing authenticated user');

        const orderedKeys = reorderedBucket.map(t => getChecklistTaskOrderKey(t));
        await upsertChecklistTaskOrder(user.id, priority, orderedKeys);
      } catch (err) {
        console.error('Failed to persist checklist order:', err);
        refetch();
      }
    },
    [refetch, setTasks]
  );

  const handleDragEnd = useCallback(
    ({
      data,
      from,
      to,
    }: {
      data: ChecklistRow[];
      from: number;
      to: number;
    }) => {
      if (from === to) return;
      const moved = data[to];
      // Drop onto a header or cross-section drop: ignore.
      // Since we never update `tasks`, `rows` stays the same and the list
      // re-renders back to the original order without a refetch.
      if (!moved || moved.type !== 'task') return;
      const targetSection = findSectionAtIndex(data, to);
      const originalPriority = normalizeChecklistPriority(
        moved.task.task.priority
      );
      if (!targetSection || targetSection !== originalPriority) return;
      const newOrderedTasks = extractTasksInSection(data, targetSection);
      handleReorder(targetSection, newOrderedTasks);
    },
    [handleReorder]
  );

  const handleLearnHow = () => {
    if (!selectedTask?.task) {
      handleCloseModal();
      return;
    }
    const { linkTab, linkModuleId, linkSubmoduleId } = selectedTask.task;
    handleCloseModal();
    const resolvedTab = linkTab && (TAB_SLUG_ALIASES[linkTab] ?? linkTab);
    if (resolvedTab && TAB_SLUG_TO_ROUTE[resolvedTab]) {
      router.push(TAB_SLUG_TO_ROUTE[resolvedTab] as any);
    } else if (linkSubmoduleId && linkModuleId) {
      router.push(
        `/(tabs)/Learn/modules/${linkModuleId}/${linkSubmoduleId}` as any
      );
    } else if (linkModuleId) {
      router.push(`/(tabs)/Learn/modules/${linkModuleId}` as any);
    } else {
      router.push('/(tabs)/Learn');
    }
  };

  const handleMarkComplete = async () => {
    if (!selectedTask) return;

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const newCompletedStatus = !selectedTask.completed;
      const completedAt = newCompletedStatus ? new Date().toISOString() : null;

      const updatedTasks = tasks.map(task => {
        const isTarget =
          selectedTask.source === 'custom'
            ? task.custom_task_id === selectedTask.custom_task_id
            : task.sanity_checklist_id === selectedTask.sanity_checklist_id;

        if (!isTarget) return task;
        return {
          ...task,
          completed: newCompletedStatus,
          completed_at: completedAt,
        };
      });
      setTasks(updatedTasks);

      setSelectedTask({
        ...selectedTask,
        completed: newCompletedStatus,
        completed_at: completedAt,
      });

      const taskTitle = selectedTask.task?.task_name || 'Unknown';
      const taskPriority = selectedTask.task?.priority || 'Unknown';
      const taskSource = selectedTask.source === 'custom' ? 'custom' : 'sanity';
      if (newCompletedStatus) {
        trackChecklistTaskCompleted(taskTitle, taskPriority, taskSource);
        handleCloseModal();
        if (confettiTimeoutRef.current) {
          clearTimeout(confettiTimeoutRef.current);
        }
        setConfettiKey(Date.now());
        confettiTimeoutRef.current = setTimeout(() => {
          setConfettiKey(null);
          confettiTimeoutRef.current = null;
        }, 1800);
      } else {
        trackChecklistTaskUncompleted(taskTitle, taskPriority, taskSource);
      }

      if (selectedTask.source === 'custom' && selectedTask.custom_task_id) {
        await setCustomChecklistTaskCompletion({
          userId: user.id,
          customTaskId: selectedTask.custom_task_id,
          completed: newCompletedStatus,
        });
      } else if (selectedTask.sanity_checklist_id) {
        await setChecklistItemCompletion(
          user.id,
          selectedTask.sanity_checklist_id,
          newCompletedStatus
        );
      }
    } catch (error) {
      console.error('Error updating task completion:', error);
      refetch();
    }
  };

  const handleDeleteCustomTask = () => {
    if (!selectedTask || selectedTask.source !== 'custom') return;
    const customTaskId = selectedTask.custom_task_id;
    if (!customTaskId) return;

    Alert.alert(t('checklist.deleteItemTitle'), t('checklist.deleteItemMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          const prevTasks = tasks;
          try {
            const {
              data: { user },
            } = await supabase.auth.getUser();
            if (!user) return;

            setTasks(prev =>
              prev.filter(task => task.custom_task_id !== customTaskId)
            );
            handleCloseModal();
            trackChecklistCustomTaskDeleted();

            await deleteCustomChecklistTask({
              userId: user.id,
              customTaskId,
            });
          } catch (error) {
            console.error('Error deleting custom checklist task:', error);
            setTasks(prevTasks);
            refetch();
          }
        },
      },
    ]);
  };

  const renderItem = useCallback(
    ({ item, drag, isActive }: RenderItemParams<ChecklistRow>) => {
      if (item.type === 'header') {
        return (
          <ChecklistSectionHeader
            priority={item.priority}
            completedCount={item.completedCount}
            totalCount={item.totalCount}
          />
        );
      }

      const task = item.task;
      const config =
        PRIORITY_CONFIG[normalizeChecklistPriority(task.task.priority)];

      return (
        <ScaleDecorator activeScale={1.03}>
          <View style={[styles.row, isActive && styles.rowActive]}>
            <View style={styles.leftColumn}>
              <View
                style={[
                  styles.timelineLine,
                  { backgroundColor: config.backgroundColor },
                  item.isLastInSection && styles.timelineLineLast,
                ]}
              />
              <GHTouchableOpacity
                onPress={() => !isActive && handleTaskPress(task)}
                disabled={isActive}
                style={[
                  styles.checkboxCircle,
                  { backgroundColor: '#FFF', borderColor: config.color },
                  task.completed && {
                    backgroundColor: config.color,
                    borderColor: config.color,
                  },
                ]}
                activeOpacity={0.7}
              >
                {task.completed && (
                  <MaterialIcons name='check' size={20} color='#FFF' />
                )}
              </GHTouchableOpacity>
            </View>

            <View style={styles.centerColumn}>
              <ChecklistItem task={task} onPress={() => handleTaskPress(task)} />
            </View>

            <GHTouchableOpacity
              style={styles.dragHandle}
              accessibilityRole='button'
              accessibilityLabel={`Reorder ${task.task.task_name}`}
              accessibilityHint="Long press and drag to change this item's order within the section"
              onLongPress={() => {
                handleDragStart();
                drag();
              }}
              delayLongPress={150}
              activeOpacity={0.6}
            >
              <MaterialIcons name='drag-indicator' size={24} color='#BDBDBD' />
            </GHTouchableOpacity>
          </View>
        </ScaleDecorator>
      );
    },
    [handleTaskPress, handleDragStart]
  );

  if (isLoading) {
    return <LoadingScreen />;
  }

  const stageDescription =
    currentStage !== null
      ? t(STAGE_KEYS[currentStage as keyof typeof STAGE_KEYS] || 'common.stageNotSet')
      : t('common.stageNotSet');
  const personaDisplay = persona
    ? t(PERSONA_KEYS[persona as keyof typeof PERSONA_KEYS] || 'common.user')
    : t('common.user');

  // Don't show checklist if stage is null
  if (currentStage === null) {
    return (
      <View style={styles.container}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.header}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{t('checklist.title')}</Text>
            </View>
            <Text style={styles.subtitle}>
              {t('checklist.onboardingRequired')}
            </Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  const ListHeader = (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{t('checklist.title')}</Text>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() =>
            router.push('/(tabs)/Checklist/create-custom-item' as any)
          }
          activeOpacity={0.8}
        >
          <MaterialIcons name='add' size={18} color='#111' />
          <Text style={styles.addButtonLabel}>{t('common.add')}</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.subtitle}>
        {personaDisplay} - {stageDescription}
      </Text>
      <View style={styles.progressContainer}>
        <View
          style={[styles.progressBar, { width: `${progressPercent * 100}%` }]}
        />
      </View>
    </View>
  );

  const ListFooter = (
    <View>
      <TouchableOpacity
        style={styles.addOwnRow}
        onPress={() =>
          router.push('/(tabs)/Checklist/create-custom-item' as any)
        }
        activeOpacity={0.7}
      >
        <MaterialIcons name='add-circle-outline' size={22} color='#6B6B6B' />
        <Text style={styles.addOwnRowText}>{t('checklist.addYourOwnItem')}</Text>
      </TouchableOpacity>

      {tasks.length === 0 && (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>
            {t('checklist.noTasksAvailable')}
          </Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <TabHeader variant='minimal' />
      <DraggableFlatList
        data={rows}
        keyExtractor={row => row.key}
        renderItem={renderItem}
        onDragEnd={handleDragEnd}
        ListHeaderComponent={ListHeader}
        ListFooterComponent={ListFooter}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: tabBarHeight + 24 },
        ]}
        activationDistance={8}
        showsVerticalScrollIndicator={false}
      />


      <TaskDetailModal
        visible={modalVisible}
        task={selectedTask}
        onClose={handleCloseModal}
        onLearnHow={handleLearnHow}
        onMarkComplete={handleMarkComplete}
        isCustomTask={selectedTask?.source === 'custom'}
        onDeleteCustomTask={handleDeleteCustomTask}
      />

      {confettiKey !== null && (
        <View pointerEvents='none' style={StyleSheet.absoluteFill}>
          <ConfettiCannon
            key={confettiKey}
            count={120}
            origin={{ x: Dimensions.get('window').width / 2, y: -20 }}
            fadeOut
            autoStart
            explosionSpeed={350}
            fallSpeed={1500}
          />
        </View>
      )}
    </View>
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
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  header: {
    marginBottom: 4,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    color: '#000',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    backgroundColor: '#fff',
  },
  addButtonLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#111',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 16,
    color: '#000',
  },
  progressContainer: {
    width: '100%',
    height: 10,
    backgroundColor: '#eaeaea',
    borderRadius: 5,
    marginTop: 16,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#000',
    borderRadius: 5,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    marginBottom: 10,
    paddingLeft: 6,
  },
  rowActive: {
    opacity: 0.95,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
    backgroundColor: '#fff',
    borderRadius: 12,
  },
  leftColumn: {
    width: 36,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  centerColumn: {
    flex: 1,
  },
  dragHandle: {
    width: 36,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  timelineLine: {
    position: 'absolute',
    top: 0,
    bottom: -10,
    left: '50%',
    marginLeft: -1,
    width: 2,
    zIndex: 0,
  },
  timelineLineLast: {
    bottom: 0,
  },
  addOwnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 20,
    marginBottom: 8,
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    borderStyle: 'dashed',
  },
  addOwnRowText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#6B6B6B',
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#A0AEC0',
    textAlign: 'center',
  },
});
