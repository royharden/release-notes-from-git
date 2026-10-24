import type { UncoveredUnits, UnitDraft } from '../../core/gitfacts/units.ts';
import { unitHeadline } from '../../core/baseline/rule-based.ts';
import { Empty } from './shared.tsx';

export function Uncovered({ uncovered, selected, disabled, onSelect, onAdd, onAddAll }: { uncovered: UncoveredUnits; selected: number; disabled: boolean; onSelect: (index: number) => void; onAdd: (unit: UnitDraft) => void; onAddAll: () => void }) {
  const all = [...uncovered.typed, ...uncovered.untyped];
  if (!all.length) return <Empty>Every eligible change has a kept citation. Noise and cancelled units remain in Internal.</Empty>;
  return <><div className="tab-intro"><p>{uncovered.typed.length} typed changes · {uncovered.untyped.length} untyped product changes without a kept citation.</p><button disabled={disabled} onClick={onAddAll}>Add all literal bullets</button></div>
    <div className="review-list">{all.map((unit, index) => <article tabIndex={0} aria-label={`Uncovered unit ${index + 1}`} data-review-item key={unit.unit_key} className={`bullet-card ${selected === index ? 'selected' : ''}`} onFocus={() => onSelect(index)} onClick={() => onSelect(index)}><div className="bullet-meta"><span className="category">{unit.type}</span><span>{unit.shas.length} commit{unit.shas.length === 1 ? '' : 's'}</span></div><p className="bullet-text">{unitHeadline(unit)}</p><ul className="paths">{unit.paths.map((path) => <li key={path}>{path}</li>)}</ul><p className="hint">Adds the commit headline with active full-SHA citations, then revalidates it.</p><button disabled={disabled} onClick={() => onAdd(unit)}>Add literal bullet</button></article>)}</div>
  </>;
}
