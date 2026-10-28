import { HistoryEvent, EventStat, StatsMap, StatSaveResult, SameEraPair, QuestionCount, SortYearGap } from '../types';
import { japanDatabase, worldDatabase } from '../data/historyData';
import { syncHistoryStatsToCloud } from '../services/studyTracker';

export const STATS_KEY = "history_quiz_stats_v3";

export function getStats(): StatsMap {
  try {
    const stats = localStorage.getItem(STATS_KEY);
    return stats ? JSON.parse(stats) : {};
  } catch (e) {
    return {};
  }
}

export function shuffle<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function isItemWeak(s?: EventStat): boolean {
  if (!s || !s.wrong || s.wrong <= 0) return false;
  if (typeof s.isWeak === 'boolean') {
    return s.isWeak;
  }
  if (typeof s.streak === 'number') {
    return s.streak < 3;
  }
  return s.correct < s.wrong * 1.5;
}

export function saveStats(id: string, isCorrect: boolean): StatSaveResult {
  const stats = getStats();
  if (!stats[id]) {
    stats[id] = { correct: 0, wrong: 0, streak: 0, isWeak: false };
  } else {
    if (typeof stats[id].streak !== 'number') {
      const currentWeak = isItemWeak(stats[id]);
      stats[id].streak = currentWeak ? 0 : 3;
      stats[id].isWeak = currentWeak;
    }
  }

  const wasWeak = isItemWeak(stats[id]);
  let newlyOvercome = false;

  if (isCorrect) {
    stats[id].correct = (stats[id].correct || 0) + 1;
    stats[id].streak = (stats[id].streak || 0) + 1;
    if (stats[id].isWeak) {
      if (stats[id].streak >= 3) {
        stats[id].isWeak = false;
        newlyOvercome = true;
      }
    }
  } else {
    stats[id].wrong = (stats[id].wrong || 0) + 1;
    stats[id].streak = 0;
    stats[id].isWeak = true;
  }

  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  syncHistoryStatsToCloud(stats);

  return {
    wasWeak,
    isWeak: stats[id].isWeak,
    streak: stats[id].streak,
    newlyOvercome
  };
}

export function resetAllStats(): void {
  localStorage.removeItem(STATS_KEY);
  syncHistoryStatsToCloud({});
}

export function getWeakItemsForField(database: HistoryEvent[], stats: StatsMap): HistoryEvent[] {
  const candidates = database.filter(item => {
    const s = stats[item.id];
    return isItemWeak(s);
  });

  if (candidates.length === 0) return [];

  candidates.sort((a, b) => {
    const sA = stats[a.id] || { correct: 0, wrong: 0, streak: 0, isWeak: false };
    const sB = stats[b.id] || { correct: 0, wrong: 0, streak: 0, isWeak: false };
    const streakA = typeof sA.streak === 'number' ? sA.streak : 0;
    const streakB = typeof sB.streak === 'number' ? sB.streak : 0;

    if (streakA !== streakB) return streakA - streakB;

    const wrongDiff = (sB.wrong || 0) - (sA.wrong || 0);
    if (wrongDiff !== 0) return wrongDiff;
    return (sA.correct || 0) - (sB.correct || 0);
  });

  return candidates;
}

export function generateAllSameEraPairs(
  japanDb: HistoryEvent[] = japanDatabase,
  worldDb: HistoryEvent[] = worldDatabase
): SameEraPair[] {
  const pairs: SameEraPair[] = [];

  // 1. 完全一致（同じ年）
  japanDb.forEach(jp => {
    const exactWorldMatch = worldDb.find(wd => wd.year === jp.year);
    if (exactWorldMatch) {
      pairs.push({
        jp,
        wd: exactWorldMatch,
        year: jp.year,
        exact: true
      });
    }
  });

  // 2. 差分が少ない（±3年以内）
  japanDb.forEach(jp => {
    if (pairs.some(p => p.jp.id === jp.id)) return;

    const nearWorldMatch = worldDb.find(wd => Math.abs(wd.year - jp.year) <= 3);
    if (nearWorldMatch) {
      pairs.push({
        jp,
        wd: nearWorldMatch,
        year: Math.round((jp.year + nearWorldMatch.year) / 2),
        exact: false
      });
    }
  });

  return pairs;
}

export function generateSameEraQuestions(
  count: QuestionCount,
  japanDb: HistoryEvent[] = japanDatabase,
  worldDb: HistoryEvent[] = worldDatabase
): SameEraPair[] {
  const allPairs = generateAllSameEraPairs(japanDb, worldDb);
  const shuffledPairs = shuffle(allPairs);
  return count === 'all' ? shuffledPairs : shuffledPairs.slice(0, count);
}

export function get4SortEvents(
  database: HistoryEvent[],
  gapLevel: SortYearGap = 'medium',
  baseItem: HistoryEvent | null = null
): HistoryEvent[] {
  if (database.length < 4) return [];

  // 1. 年の重複を除いた出来事リストを作成
  const eventsByYear = new Map<number, HistoryEvent>();
  const shuffledDb = shuffle([...database]);
  shuffledDb.forEach(item => {
    if (!eventsByYear.has(item.year)) {
      eventsByYear.set(item.year, item);
    }
  });

  const distinctEvents = Array.from(eventsByYear.values()).sort((a, b) => a.year - b.year);
  if (distinctEvents.length < 4) {
    return distinctEvents;
  }

  // 2. ユーザー指定の年代差設定（隣り合う年号の差）
  // 近い: 2〜10年 (min:1, max:10, target: 5)
  // 中間: 10〜25年 (min:10, max:25, target: 18)
  // 遠い: 25〜50年 (min:25, max:50+, target: 35)
  let minGap = 2;
  let maxGap = 10;
  let idealGap = 5;

  if (gapLevel === 'near') {
    minGap = 1;
    maxGap = 10;
    idealGap = 5;
  } else if (gapLevel === 'medium') {
    minGap = 10;
    maxGap = 25;
    idealGap = 18;
  } else { // 'far'
    minGap = 25;
    maxGap = 55;
    idealGap = 35;
  }

  // 試行1: 対象範囲(minGap〜maxGap)で連続する4つのイベントを探索
  const attempts = 40;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let startIdx: number;
    if (baseItem && attempt < 10) {
      const idx = distinctEvents.findIndex(e => e.id === baseItem.id || e.year === baseItem.year);
      startIdx = idx >= 0 ? idx : Math.floor(Math.random() * (distinctEvents.length - 3));
    } else {
      startIdx = Math.floor(Math.random() * (distinctEvents.length - 3));
    }

    const seq: HistoryEvent[] = [distinctEvents[startIdx]];

    for (let i = startIdx + 1; i < distinctEvents.length && seq.length < 4; i++) {
      const prevYear = seq[seq.length - 1].year;
      const currentYear = distinctEvents[i].year;
      const gap = currentYear - prevYear;

      if (gap >= minGap && gap <= maxGap) {
        seq.push(distinctEvents[i]);
      }
    }

    if (seq.length === 4) {
      return seq;
    }
  }

  // 試行2: 条件を満たす完璧な連鎖が見つからなかった場合、4つのイベント間の平均ギャップが最も idealGap に近い組み合わせを選択
  let bestSequence: HistoryEvent[] | null = null;
  let bestScore = Infinity;

  // ランダムサンプリングで最良の4件セットを選択
  for (let t = 0; t < 60; t++) {
    const sample = shuffle(distinctEvents).slice(0, 4).sort((a, b) => a.year - b.year);
    if (sample.length === 4) {
      const g1 = sample[1].year - sample[0].year;
      const g2 = sample[2].year - sample[1].year;
      const g3 = sample[3].year - sample[2].year;

      // 理想のギャップからの乖離スコアを計算（小さいほど良い）
      const score = Math.abs(g1 - idealGap) + Math.abs(g2 - idealGap) + Math.abs(g3 - idealGap);

      if (score < bestScore) {
        bestScore = score;
        bestSequence = sample;
      }
    }
  }

  return bestSequence || shuffle(distinctEvents).slice(0, 4);
}

export function get4CloseDistinctYearEvents(
  database: HistoryEvent[],
  baseItem: HistoryEvent | null = null
): HistoryEvent[] {
  return get4SortEvents(database, 'near', baseItem);
}

export function matchTimelineFilter(
  item: HistoryEvent,
  query: string,
  fieldTab: 'all' | 'japan' | 'world',
  stats: StatsMap
): boolean {
  const isJapan = item.id.startsWith("jp_");
  if (fieldTab === 'japan' && !isJapan) return false;
  if (fieldTab === 'world' && isJapan) return false;

  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const tokens = q.split(/[\s,、　]+/).filter(t => t.length > 0);
  if (tokens.length === 0) return true;

  for (const token of tokens) {
    const rangeMatch = token.match(/^(\d{1,4})[-〜~](\d{1,4})$/);
    if (rangeMatch) {
      const startY = parseInt(rangeMatch[1], 10);
      const endY = parseInt(rangeMatch[2], 10);
      const min = Math.min(startY, endY);
      const max = Math.max(startY, endY);
      if (item.year < min || item.year > max) return false;
      continue;
    }

    if (/^\d{1,4}$/.test(token)) {
      const yNum = parseInt(token, 10);
      const yearStr = String(item.year);
      const matchesYear = (item.year === yNum) || yearStr.includes(token);
      const matchesText = (item.event && item.event.toLowerCase().includes(token)) ||
                          (item.description && item.description.toLowerCase().includes(token));
      if (!matchesYear && !matchesText) return false;
      continue;
    }

    if (token === '日本史' || token === '日本') {
      if (!isJapan) return false;
      continue;
    }
    if (token === '世界史' || token === '世界') {
      if (isJapan) return false;
      continue;
    }

    if (token === '苦手' || token === '間違えた' || token === 'ミス' || token === '要復習') {
      const s = stats[item.id] || { correct: 0, wrong: 0, streak: 0, isWeak: false };
      if (!isItemWeak(s)) return false;
      continue;
    }

    const eventText = (item.event || "").toLowerCase();
    const descText = (item.description || "").toLowerCase();
    if (!eventText.includes(token) && !descText.includes(token)) {
      return false;
    }
  }

  return true;
}
