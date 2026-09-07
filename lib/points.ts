// Presentation unit only: the server remains the source of membership charges.
export const POINTS_PER_MINUTE = 100;
export const pointsForSeconds = (seconds: number) => seconds * POINTS_PER_MINUTE / 60;
export const formatPoints = (seconds: number) => `${pointsForSeconds(seconds).toLocaleString('en-US', { maximumFractionDigits: 2 })} Points`;
