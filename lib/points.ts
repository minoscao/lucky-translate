import { SECONDS_PER_FISH } from './membership-plans';

// One fish equals 72 billed seconds: Lv2's 120 minutes provide 100 fish.
export const POINTS_PER_MINUTE = 60 / SECONDS_PER_FISH;
export const pointsForSeconds = (seconds: number) => seconds * POINTS_PER_MINUTE / 60;
export const formatPoints = (seconds: number) => `${pointsForSeconds(seconds).toLocaleString('en-US', { maximumFractionDigits: 2 })} 条小鱼干`;
