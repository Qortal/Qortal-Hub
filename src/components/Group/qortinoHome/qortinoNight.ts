/** Late at night (23:00 to 5:00), when Qortino dozes off with nothing to do. */
export const isNightHour = (hour: number) => hour >= 23 || hour < 5;
