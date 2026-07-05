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
};
