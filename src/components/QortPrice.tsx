import { useCallback, useEffect, useState } from 'react';
import { getBaseApiReact } from '../App';
import { Box, Tooltip, Typography, useTheme } from '@mui/material';
import { BarSpinner } from '../common/Spinners/BarSpinner/BarSpinner';
import { formatDate } from '../utils/time';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';

function getAverageLtcPerQort(trades) {
  let totalQort = 0;
  let totalLtc = 0;

  trades.forEach((trade) => {
    const qort = parseFloat(trade.qortAmount);
    const ltc = parseFloat(trade.foreignAmount);

    totalQort += qort;
    totalLtc += ltc;
  });

  // Avoid division by zero
  if (totalQort === 0) return 0;

  // Weighted average price
  return parseFloat((totalLtc / totalQort).toFixed(8));
}

function getTwoWeeksAgoTimestamp() {
  const now = new Date();
  now.setDate(now.getDate() - 14); // Subtract 14 days
  return now.getTime(); // Get timestamp in milliseconds
}

function formatWithCommasAndDecimals(number: number) {
  const locale = i18next.language;
  return Number(number).toLocaleString(locale);
}

export const QortPrice = () => {
  const [ltcPerQort, setLtcPerQort] = useState(null);
  const [supply, setSupply] = useState<string>('');
  const [lastBlock, setLastBlock] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation(['core', 'tutorial']);
  const theme = useTheme();

  const getPrice = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${getBaseApiReact()}/crosschain/trades?foreignBlockchain=LITECOIN&minimumTimestamp=${getTwoWeeksAgoTimestamp()}&limit=20&reverse=true`
      );
      const data = await response.json();
      setLtcPerQort(getAverageLtcPerQort(data));
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  const getLastBlock = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`${getBaseApiReact()}/blocks/last`);
      const data = await response.json();
      setLastBlock(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  const getSupplyInCirculation = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(
        `${getBaseApiReact()}/stats/supply/circulating`
      );
      const data = await response.text();
      setSupply(formatWithCommasAndDecimals(parseFloat(data)));
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    getPrice();
    getSupplyInCirculation();
    getLastBlock();
    const interval = setInterval(() => {
      getPrice();
      getSupplyInCirculation();
      getLastBlock();
    }, 900000);

    return () => clearInterval(interval);
  }, [getPrice]);

  return (
    <Box
      sx={{
        display: 'flex',
        gap: '20px',
        flexWrap: 'wrap',
        flexDirection: 'column',
        width: '322px',
      }}
    >
      <Tooltip
        title={
          <span style={{ fontSize: '14px', fontWeight: 700 }}>
            Based on the latest 20 trades
          </span>
        }
        placement="bottom"
        arrow
        sx={{ fontSize: '24' }}
        slotProps={{
          tooltip: {
            sx: {
              color: theme.palette.text.primary,
              backgroundColor: theme.palette.background.paper,
            },
          },
          arrow: {
            sx: {
              color: theme.palette.text.primary,
            },
          },
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'row',
            gap: '10px',
            justifyContent: 'space-between',
            width: '322px',
          }}
        >
          <Typography
            sx={{
              fontSize: '1rem',
              fontWeight: 'bold',
            }}
          >
            {t('core:price', { postProcess: 'capitalizeFirstChar' })}
          </Typography>

          {!ltcPerQort ? (
            <BarSpinner width="16px" color={theme.palette.text.primary} />
          ) : (
            <Typography
              sx={{
                fontSize: '1rem',
              }}
            >
              {ltcPerQort} LTC/QORT
            </Typography>
          )}
        </Box>
      </Tooltip>

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'row',
          gap: '10px',
          justifyContent: 'space-between',
          width: '322px',
        }}
      >
        <Typography
          sx={{
            fontSize: '1rem',
            fontWeight: 'bold',
          }}
        >
          {t('core:supply', { postProcess: 'capitalizeFirstChar' })}
        </Typography>

        {!supply ? (
          <BarSpinner width="16px" color={theme.palette.text.primary} />
        ) : (
          <Typography
            sx={{
              fontSize: '1rem',
            }}
          >
            {supply} QORT
          </Typography>
        )}
      </Box>

      <Tooltip
        title={
          <span style={{ fontSize: '14px', fontWeight: 700 }}>
            {lastBlock?.timestamp && formatDate(lastBlock?.timestamp)}
          </span>
        }
        placement="bottom"
        arrow
        sx={{ fontSize: '24' }}
        slotProps={{
          tooltip: {
            sx: {
              color: theme.palette.text.primary,
              backgroundColor: theme.palette.background.paper,
            },
          },
          arrow: {
            sx: {
              color: theme.palette.text.primary,
            },
          },
        }}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'row',
            gap: '10px',
            justifyContent: 'space-between',
            width: '322px',
          }}
        >
          <Typography
            sx={{
              fontSize: '1rem',
              fontWeight: 'bold',
            }}
          >
            {t('core:last_height', { postProcess: 'capitalizeFirstChar' })}
          </Typography>

          {!lastBlock?.height ? (
            <BarSpinner width="16px" color={theme.palette.text.primary} />
          ) : (
            <Typography
              sx={{
                fontSize: '1rem',
              }}
            >
              {formatWithCommasAndDecimals(lastBlock?.height)}
            </Typography>
          )}
        </Box>
      </Tooltip>
    </Box>
  );
};
