import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import classes from './bracket_tree.module.css';

export interface BracketTreeMatch {
  id: number | string;
  topSeed: string;
  topName: string;
  topScore: number;
  bottomSeed: string;
  bottomName: string;
  bottomScore: number;
  sourceMatchIds?: Array<number | string>;
  note?: string;
  status?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETE';
}

export interface BracketTreeColumn {
  id: number | string;
  name: string;
  matches: BracketTreeMatch[];
}

export interface BracketTreeSection {
  id: number | string;
  name: string;
  description?: string;
  columns: BracketTreeColumn[];
}

const MATCH_HEIGHT_PX = 62;
const FIRST_ROUND_CENTER_GAP_PX = 96;

function buildSectionLayout(columns: BracketTreeColumn[]): {
  matchTopById: Record<string, number>;
  columnHeightPx: number;
} {
  if (columns.length < 1) {
    return { matchTopById: {}, columnHeightPx: MATCH_HEIGHT_PX + 8 };
  }

  const roundCount = columns.length;
  const unitPx = FIRST_ROUND_CENTER_GAP_PX / Math.max(2 ** roundCount, 1);
  const minColumnGapUnits = Math.max(1.5, FIRST_ROUND_CENTER_GAP_PX / Math.max(unitPx, 1));
  const centerOffsetPx = MATCH_HEIGHT_PX / 2 + 8;

  const positionByMatchId: Record<string, number> = {};
  const usedPositionsByColumn: Record<number, number[]> = {};

  columns.forEach((column, columnIndex) => {
    const fallbackBase = 2 ** Math.max(roundCount - columnIndex - 1, 0);
    usedPositionsByColumn[columnIndex] = [];

    column.matches.forEach((match, matchIndex) => {
      const matchId = String(match.id);
      const sourcePositions = (match.sourceMatchIds ?? [])
        .map((sourceId) => positionByMatchId[String(sourceId)])
        .filter((value) => Number.isFinite(value));

      let position =
        sourcePositions.length > 0
          ? sourcePositions.reduce((sum, value) => sum + value, 0) / sourcePositions.length
          : (2 * matchIndex + 1) * fallbackBase;

      // Keep sibling matches visually separated by at least first-round spacing.
      const sortedUsedPositions = [...usedPositionsByColumn[columnIndex]].sort(
        (left, right) => left - right
      );
      for (const usedPosition of sortedUsedPositions) {
        if (position - usedPosition < minColumnGapUnits) {
          position = usedPosition + minColumnGapUnits;
        }
      }

      usedPositionsByColumn[columnIndex].push(position);
      positionByMatchId[matchId] = position;
    });
  });

  const centerByMatchId = Object.entries(positionByMatchId).reduce(
    (result: Record<string, number>, [matchId, position]) => {
      result[matchId] = centerOffsetPx + position * unitPx;
      return result;
    },
    {}
  );
  const matchTopById = Object.entries(centerByMatchId).reduce(
    (result: Record<string, number>, [matchId, centerY]) => {
      result[matchId] = Math.max(0, centerY - MATCH_HEIGHT_PX / 2);
      return result;
    },
    {}
  );
  const maxTop = Object.values(matchTopById).reduce(
    (maxValue, top) => Math.max(maxValue, top),
    0
  );

  return {
    matchTopById,
    columnHeightPx: Math.ceil(maxTop + MATCH_HEIGHT_PX + 12),
  };
}

function BracketTreeSectionView({ section }: { section: BracketTreeSection }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const matchRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [paths, setPaths] = useState<string[]>([]);
  const sectionLayout = useMemo(() => buildSectionLayout(section.columns), [section.columns]);

  const allMatchIds = useMemo(
    () =>
      section.columns.flatMap((column) =>
        column.matches.map((match) => String(match.id))
      ),
    [section.columns]
  );

  useEffect(() => {
    const ids = new Set(allMatchIds);
    for (const matchId of Object.keys(matchRefs.current)) {
      if (!ids.has(matchId)) {
        delete matchRefs.current[matchId];
      }
    }
  }, [allMatchIds]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container == null) {
      setPaths([]);
      return;
    }

    let rafId = 0;
    const calculatePaths = () => {
      const containerRect = container.getBoundingClientRect();
      const nextPaths: string[] = [];

      section.columns.forEach((column) => {
        column.matches.forEach((match) => {
          const targetNode = matchRefs.current[String(match.id)];
          if (targetNode == null) return;

          const sourceMatchIds = Array.from(
            new Set((match.sourceMatchIds ?? []).map((id) => String(id)))
          );
          if (sourceMatchIds.length < 1) return;

          const targetRect = targetNode.getBoundingClientRect();
          const x2 = targetRect.left - containerRect.left;
          const y2 = targetRect.top + targetRect.height / 2 - containerRect.top;

          sourceMatchIds.forEach((sourceMatchId) => {
            const sourceNode = matchRefs.current[sourceMatchId];
            if (sourceNode == null) return;
            const sourceRect = sourceNode.getBoundingClientRect();
            const x1 = sourceRect.right - containerRect.left;
            const y1 = sourceRect.top + sourceRect.height / 2 - containerRect.top;
            const horizontalGap = Math.max(18, (x2 - x1) / 2);
            const midX = x1 + horizontalGap;
            nextPaths.push(`M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`);
          });
        });
      });

      setPaths(nextPaths);
    };

    const schedule = () => {
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(calculatePaths);
    };

    window.addEventListener('resize', schedule);
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    observer?.observe(container);
    schedule();

    return () => {
      window.removeEventListener('resize', schedule);
      observer?.disconnect();
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [section.columns]);

  return (
    <div className={classes.sectionBlock}>
      <div className={classes.sectionHeader}>{section.name}</div>
      {section.description != null && section.description.trim() !== '' ? (
        <div className={classes.sectionDescription}>{section.description}</div>
      ) : null}
      <div className={classes.bracket} ref={containerRef}>
        <svg
          className={classes.connectionLayer}
          aria-hidden="true"
          width="100%"
          height="100%"
          preserveAspectRatio="none"
        >
          {paths.map((path, index) => (
            <path key={`connector-${index}`} d={path} className={classes.connectionPath} />
          ))}
        </svg>
        {section.columns.map((column) => (
          <div key={column.id} className={classes.column}>
            <div className={classes.columnHeader}>{column.name}</div>
            <div
              className={classes.columnMatches}
              style={{ height: `${sectionLayout.columnHeightPx}px` }}
            >
              {column.matches.map((match) => {
                const topWinsByScore = match.topScore > match.bottomScore;
                const bottomWinsByScore = match.bottomScore > match.topScore;
                const topWinsByBye = match.bottomName === 'BYE' && match.topName !== 'BYE';
                const bottomWinsByBye = match.topName === 'BYE' && match.bottomName !== 'BYE';
                const winnerClass =
                  topWinsByScore || topWinsByBye
                    ? classes.winnerTop
                    : bottomWinsByScore || bottomWinsByBye
                      ? classes.winnerBottom
                      : '';
                const hasResult =
                  topWinsByScore || bottomWinsByScore || topWinsByBye || bottomWinsByBye;
                const status = match.status ?? (hasResult ? 'COMPLETE' : 'PENDING');
                const topIsLoser = hasResult && (bottomWinsByScore || bottomWinsByBye);
                const bottomIsLoser = hasResult && (topWinsByScore || topWinsByBye);
                const statusClass =
                  status === 'COMPLETE'
                    ? `${classes.matchStatus} ${classes.statusComplete}`
                    : status === 'IN_PROGRESS'
                      ? `${classes.matchStatus} ${classes.statusInProgress}`
                      : `${classes.matchStatus} ${classes.statusPending}`;
                const statusLabel =
                  status === 'COMPLETE'
                    ? 'Complete'
                    : status === 'IN_PROGRESS'
                      ? 'In Progress'
                      : 'Pending';

                return (
                  <div
                    key={match.id}
                    className={winnerClass === '' ? classes.match : `${classes.match} ${winnerClass}`}
                    style={{ top: `${sectionLayout.matchTopById[String(match.id)] ?? 0}px` }}
                    ref={(node) => {
                      matchRefs.current[String(match.id)] = node;
                    }}
                  >
                    <span className={statusClass}>{statusLabel}</span>
                    {match.note != null && match.note.trim() !== '' ? (
                      <span className={classes.matchNote}>{match.note}</span>
                    ) : null}
                    <div
                      className={
                        topIsLoser
                          ? `${classes.team} ${classes.matchTop} ${classes.loserTeam}`
                          : `${classes.team} ${classes.matchTop}`
                      }
                    >
                      <span className={classes.image} />
                      <span className={classes.seed}>{match.topSeed}</span>
                      <span className={classes.name}>{match.topName}</span>
                      <span className={classes.score}>{match.topScore}</span>
                    </div>
                    <div
                      className={
                        bottomIsLoser
                          ? `${classes.team} ${classes.matchBottom} ${classes.loserTeam}`
                          : `${classes.team} ${classes.matchBottom}`
                      }
                    >
                      <span className={classes.image} />
                      <span className={classes.seed}>{match.bottomSeed}</span>
                      <span className={classes.name}>{match.bottomName}</span>
                      <span className={classes.score}>{match.bottomScore}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BracketTree({
  columns,
  sections,
}: {
  columns?: BracketTreeColumn[];
  sections?: BracketTreeSection[];
}) {
  const normalizedSections = useMemo(() => {
    const validSections = (sections ?? []).filter(
      (section) => section != null && Array.isArray(section.columns) && section.columns.length > 0
    );
    if (validSections.length > 0) {
      return validSections;
    }

    if (Array.isArray(columns) && columns.length > 0) {
      return [
        {
          id: 'main',
          name: 'Bracket',
          columns,
        },
      ] as BracketTreeSection[];
    }

    return [] as BracketTreeSection[];
  }, [columns, sections]);

  if (normalizedSections.length < 1) {
    return null;
  }

  return (
    <div className={`${classes.theme} ${classes.themeDark}`}>
      <div className={classes.scrollWrap}>
        <div className={classes.sections}>
          {normalizedSections.map((section) => (
            <BracketTreeSectionView key={section.id} section={section} />
          ))}
        </div>
      </div>
    </div>
  );
}
