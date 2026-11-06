export { NavProvider, NavRoot, NavEntry, useActiveRoot, useNav, useNavScope, useNavState, useNavStore, useResetNav, useRestoreScroll, useSubEntry, resetDetachedNav } from './react';
export { NavStore, type NavEntry as NavEntryData } from './store';
export { dirtyGuard, useDirtyGuard } from './dirtyGuard';
export { default as DirtyGuardHost } from './DirtyGuardHost';
export { BackStack, backStack } from './backStack';
export { clearNavStorage, buildSnapshot, type PersistSpec } from './storage';
