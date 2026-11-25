export const shouldBlockChatForLowBalance = (
  balance: unknown,
  minimumBalance: number,
  reticulumEnabled: boolean
): boolean => !reticulumEnabled && Number(balance) < minimumBalance;
