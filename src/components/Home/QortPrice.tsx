import React, { useCallback, useEffect, useState } from "react";
import { getBaseApiReact } from "../../App";
import { Box, Tooltip, Typography } from "@mui/material";
import { BarSpinner } from "../../common/Spinners/BarSpinner/BarSpinner";
import { formatDate } from "../../utils/time";

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

function formatWithCommasAndDecimals(number) {
  return Number(number).toLocaleString();
}

export const QortPrice = () => {
  const [ltcPerQort, setLtcPerQort] = useState(null);
  const [supply, setSupply] = useState(null);
  const [lastBlock, setLastBlock] = useState(null);
  const [loading, setLoading] = useState(true);

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
      formatWithCommasAndDecimals(data);
      setSupply(formatWithCommasAndDecimals(data));
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
        display: "flex",
        gap: "20px",
        flexWrap: "wrap",
        flexDirection: "column",
        width: "322px",
      }}
    >
      <Tooltip
        title={
          <span style={{ color: "white", fontSize: "14px", fontWeight: 700 }}>
            Based on the latest 20 trades
          </span>
        }
        placement="bottom"
        arrow
        sx={{ fontSize: "24" }}
        slotProps={{
          tooltip: {
            sx: {
              color: "#ffffff",
              backgroundColor: "#444444",
            },
          },
          arrow: {
            sx: {
              color: "#444444",
            },
          },
        }}
      >
        <Box
          sx={{
            width: "322px",
            display: "flex",
            flexDirection: "row",
            gap: "10px",

            justifyContent: "space-between",
          }}
        >
          <Typography
            sx={{
              fontSize: "1rem",
              fontWeight: "bold",
            }}
          >
            Price
          </Typography>
          {!ltcPerQort ? (
            <BarSpinner width="16px" color="white" />
          ) : (
            <Typography
              sx={{
                fontSize: "1rem",
              }}
            >
              {ltcPerQort} LTC/QORT
            </Typography>
          )}
        </Box>
      </Tooltip>
      <Box
        sx={{
          width: "322px",
          display: "flex",
          flexDirection: "row",
          gap: "10px",

          justifyContent: "space-between",
        }}
      >
        <Typography
          sx={{
            fontSize: "1rem",
            fontWeight: "bold",
          }}
        >
          Supply
        </Typography>
        {!supply ? (
          <BarSpinner width="16px" color="white" />
        ) : (
          <Typography
            sx={{
              fontSize: "1rem",
            }}
          >
            {supply} QORT
          </Typography>
        )}
      </Box>
      <Tooltip
          title={
            <span style={{ color: "white", fontSize: "14px", fontWeight: 700 }}>
              {lastBlock?.timestamp && formatDate(lastBlock?.timestamp)}
            </span>
          }
          placement="bottom"
          arrow
          sx={{ fontSize: "24" }}
          slotProps={{
            tooltip: {
              sx: {
                color: "#ffffff",
                backgroundColor: "#444444",
              },
            },
            arrow: {
              sx: {
                color: "#444444",
              },
            },
          }}
        >
      <Box
        sx={{
          width: "322px",
          display: "flex",
          flexDirection: "row",
          gap: "10px",

          justifyContent: "space-between",
        }}
      >
        
          <Typography
            sx={{
              fontSize: "1rem",
              fontWeight: "bold",
            }}
          >
            Last height
          </Typography>
          {!lastBlock?.height ? (
            <BarSpinner width="16px" color="white" />
          ) : (
            <Typography
              sx={{
                fontSize: "1rem",
              }}
            >
              {lastBlock?.height}
            </Typography>
          )}
       
      </Box>
      </Tooltip>
    </Box>
  );
};
