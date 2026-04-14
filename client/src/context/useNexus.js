/**
 * Convenience hooks for accessing Nexus shared context.
 * Each hook triggers lazy loading of its context's data slices.
 */
import { useContext, useEffect } from 'react';
import { NexusCoreCtx, NexusFuelCtx, NexusFleetCtx } from './NexusProvider.jsx';

export function useNexusCore() {
  const ctx = useContext(NexusCoreCtx);
  if (!ctx) throw new Error('useNexusCore must be within NexusProvider');
  useEffect(() => { ctx._ensureAll(); }, []);
  return ctx;
}

export function useNexusFuel() {
  const ctx = useContext(NexusFuelCtx);
  if (!ctx) throw new Error('useNexusFuel must be within NexusProvider');
  useEffect(() => { ctx._ensureAll(); }, []);
  return ctx;
}

export function useNexusFleet() {
  const ctx = useContext(NexusFleetCtx);
  if (!ctx) throw new Error('useNexusFleet must be within NexusProvider');
  useEffect(() => { ctx._ensureAll(); }, []);
  return ctx;
}
