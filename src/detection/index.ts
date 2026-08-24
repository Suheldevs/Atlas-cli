/**
 * Project detection.
 *
 * Answers "what am I generating into?" once, from the filesystem, and hands the result to
 * every generator as an immutable `ProjectContext`. Nothing in here writes, prints, or
 * decides anything about generation — it only reports what is already true of the project.
 */

export { detectDatabase } from './detectors/database.detector.js';
export { detectFramework } from './detectors/framework.detector.js';
export {
  detectLanguage,
  readTsconfig,
  type LanguageDetection,
  type TsconfigProbe,
} from './detectors/language.detector.js';
export { detectModuleSystem } from './detectors/module-system.detector.js';
export { detectWorkspace } from './detectors/monorepo.detector.js';
export { detectPackageManager } from './detectors/package-manager.detector.js';
export { detectSourceLayout } from './detectors/src-layout.detector.js';
export { hasDependency, readManifest } from './manifest-reader.js';
export { ProjectScanner, type ScannerDependencies } from './project-scanner.js';

export type {
  DatabaseLayer,
  Framework,
  Language,
  ModuleSystem,
  PackageManager,
  PackageManifest,
  ProjectContext,
  SourceLayout,
  TypeScriptInfo,
  WorkspaceInfo,
} from '../types/project-context.js';
