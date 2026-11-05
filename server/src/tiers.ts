// Truecaller sender tiers and their daily message limits in India (TC Business Chat guardrails).
// Promotional senders start at Tier 1 and move up with good spam scores; other senders start at Tier 4.
export const TIER_LIMITS: Record<number, number | null> = { 0: 10_000, 1: 500_000, 2: 2_500_000, 3: 10_000_000, 4: null };
export const defaultTier = (category: string) => (category === 'promotional' ? 1 : 4);
