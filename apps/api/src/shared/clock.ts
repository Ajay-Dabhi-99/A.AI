/** Time source. Services take a Clock so expiry logic is testable without waiting. */
export type Clock = {
  now(): Date;
};

export const systemClock: Clock = {
  now: () => new Date(),
};
