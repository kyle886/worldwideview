/**
 * Slice creator pattern for the custom `viewStore` pub/sub.
 *
 * Inspired by Zustand's `StateCreator<...>` but adapted to Stratosfyre's
 * existing custom store. A slice declares some state fields + mutators; the
 * mutators close over `get` and `set` provided by the composer.
 *
 * Why not just switch to Zustand? Stratosfyre's `viewStore` has a public
 * pub/sub API (`store.subscribe`, `store.getState`) consumed in multiple
 * places (DeckGlobe, controllers, tests). Slicing internally is a
 * behavior-preserving refactor; swapping the library is not.
 *
 * Notification rule (preserved from current viewStore): every mutator calls
 * `set(...)` which notifies every listener. No equality short-circuit.
 */

export type SliceCreator<TSlice, TFullState> = (
  get: () => TFullState,
  set: (patch: Partial<TFullState>) => void,
) => TSlice;
