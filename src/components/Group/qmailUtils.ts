import moment from 'moment';
import { TIME_WEEKS_1_IN_MILLISECONDS } from '../../constants/constants';

export function isLessThanOneWeekOld(timestamp: number): boolean {
  return timestamp > Date.now() - TIME_WEEKS_1_IN_MILLISECONDS;
}

export function formatEmailDate(timestamp: number): string {
  const date = moment(timestamp);
  const now = moment();
  if (date.isSame(now, 'day')) {
    return date.format('h:mm A');
  }
  if (date.isSame(now, 'year')) {
    return date.format('MMM D');
  }
  return date.format('MMM D, YYYY');
}
