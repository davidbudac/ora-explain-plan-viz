import type { AdvisorRule } from '../types';
import { implicitConversionRule } from './implicitConversion';
import { nestedLoopVolumeRule } from './nestedLoopVolume';
import { mergeJoinCartesianRule } from './mergeJoinCartesian';
import { selectiveFullScanRule } from './selectiveFullScan';
import { unusedIndexRule } from './unusedIndex';
import { cardinalityMismatchRule } from './cardinalityMismatch';
import { spillToDiskRule } from './spillToDisk';
import { statsIssuesRule } from './statsIssues';
import { partitionPruningRule } from './partitionPruning';
import { parallelSignalsRule } from './parallelSignals';
import { perRowReexecutionRule } from './perRowReexecution';
import { indexRowsDiscardedRule } from './indexRowsDiscarded';
import { bufferEfficiencyRule } from './bufferEfficiency';
import { planNotesRule } from './planNotes';
import { functionOnIndexedColumnRule } from './functionOnIndexedColumn';
import { hashJoinBuildSideRule } from './hashJoinBuildSide';

export const ALL_RULES: AdvisorRule[] = [
  implicitConversionRule,
  nestedLoopVolumeRule,
  mergeJoinCartesianRule,
  selectiveFullScanRule,
  unusedIndexRule,
  cardinalityMismatchRule,
  spillToDiskRule,
  statsIssuesRule,
  partitionPruningRule,
  parallelSignalsRule,
  perRowReexecutionRule,
  indexRowsDiscardedRule,
  bufferEfficiencyRule,
  planNotesRule,
  functionOnIndexedColumnRule,
  hashJoinBuildSideRule,
];

export {
  implicitConversionRule,
  nestedLoopVolumeRule,
  mergeJoinCartesianRule,
  selectiveFullScanRule,
  unusedIndexRule,
  cardinalityMismatchRule,
  spillToDiskRule,
  statsIssuesRule,
  partitionPruningRule,
  parallelSignalsRule,
  perRowReexecutionRule,
  indexRowsDiscardedRule,
  bufferEfficiencyRule,
  planNotesRule,
  functionOnIndexedColumnRule,
  hashJoinBuildSideRule,
};
