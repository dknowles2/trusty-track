import React from 'react';
import type { EliminationChart, EliminationChartHeat } from '../types';
import { describeChart, displayOrder, isUpcoming, laneMark, lossPips, waveTitle } from '../eliminationChart';

interface EliminationChartViewProps {
  chart: EliminationChart;
  getRacerName: (id: number) => string;
}

const heatBorderColor = (heat: EliminationChartHeat): string => {
  if (!heat.finished) return 'var(--border-color)';
  return 'var(--divider-color)';
};

/**
 * The schedule screen's elimination chart (#710) — the record of the round
 * so far, wave by wave. Not a bracket: a bracket draws matchups that have
 * not happened, and this format grows its schedule from the results rather
 * than promising one (`domain/elimination.chart`'s own docstring says this
 * once; it is worth saying again here, since this is the one place it is
 * drawn). Every wave shown here is heats that actually exist — raced, or
 * pending with real rows — and the wave after the pending one is absent,
 * because nobody knows who will be in it yet.
 *
 * Pure layout only; the rule for what each mark means lives in
 * `../eliminationChart.ts`.
 */
export const EliminationChartView: React.FC<EliminationChartViewProps> = ({ chart, getRacerName }) => (
  <div data-testid="elimination-chart">
    <p style={{ margin: '0 0 16px', fontSize: '0.9rem', color: 'var(--text-muted-color)' }}>
      {describeChart(chart)}
    </p>
    <div style={{ display: 'flex', gap: '20px', overflowX: 'auto', paddingBottom: '8px' }}>
      {chart.waves.map((wave) => (
        <div key={wave.number} style={{ minWidth: '240px', flexShrink: 0 }}>
          <h4
            style={{
              margin: '0 0 10px',
              fontSize: '0.8rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              color: isUpcoming(wave) ? 'var(--scouting-blue)' : 'var(--text-muted-color)',
            }}
          >
            {waveTitle(wave)}
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {wave.heats.map((heat) => (
              <div
                key={heat.heatId}
                data-testid={`elimination-chart-heat-${heat.heatId}`}
                style={{
                  border: `1px solid ${heatBorderColor(heat)}`,
                  borderRadius: '8px',
                  padding: '8px 10px',
                  background: 'var(--surface-color)',
                }}
              >
                <div
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 'bold',
                    color: 'var(--text-faint-color)',
                    marginBottom: '4px',
                  }}
                >
                  Heat {heat.heatNumber}
                </div>
                {displayOrder(heat).map((lane) => (
                  <div
                    key={lane.lane}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: '8px',
                      fontSize: '0.85rem',
                      padding: '2px 0',
                      opacity: lane.out ? 0.6 : 1,
                      textDecoration: lane.out ? 'line-through' : 'none',
                    }}
                  >
                    <span style={{ fontWeight: lane.outcome === 'WON' ? 600 : 400 }}>
                      {lane.racerId != null ? getRacerName(lane.racerId) : '—'}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexShrink: 0 }}>
                      {lane.racerId != null && (
                        <span
                          style={{ fontFamily: 'monospace', color: 'var(--warning-soft-color)', fontSize: '0.75rem' }}
                          title={`${lane.lossesAfter} of ${chart.maxLosses}`}
                        >
                          {lossPips(lane.lossesAfter, chart.maxLosses)}
                        </span>
                      )}
                      <span
                        style={{
                          fontSize: '0.7rem',
                          color:
                            lane.outcome === 'WON'
                              ? 'var(--success-color)'
                              : lane.out
                                ? 'var(--danger-strong-color)'
                                : 'var(--text-muted-color)',
                        }}
                      >
                        {laneMark(lane, chart.maxLosses)}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
);
