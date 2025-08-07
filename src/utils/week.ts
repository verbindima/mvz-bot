export const getCurrentWeek = (): { week: number; year: number } => {
  const date = new Date();
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - startOfYear.getTime()) / 86400000) + 1;
  const startOfWeek = startOfYear.getDay();
  
  const week = Math.ceil((dayOfYear + startOfWeek - 1) / 7);
  
  return {
    week,
    year: date.getFullYear(),
  };
};

export const getWeekString = (week: number, year: number): string => {
  return `${year}-W${week.toString().padStart(2, '0')}`;
};