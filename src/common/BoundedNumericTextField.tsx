import {
  IconButton,
  InputAdornment,
  TextField,
  TextFieldProps,
} from "@mui/material";
import React, { useRef, useState } from "react";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import {
  removeTrailingZeros,
  setNumberWithinBounds,
} from "./numberFunctions.ts";
import { CustomInput } from "../App-styles.ts";

type eventType = React.ChangeEvent<HTMLInputElement>;
type BoundedNumericTextFieldProps = {
  minValue: number;
  maxValue: number;
  addIconButtons?: boolean;
  allowDecimals?: boolean;
  allowNegatives?: boolean;
  afterChange?: (s: string) => void;
  initialValue?: string;
  maxSigDigits?: number;
} & TextFieldProps;

export const BoundedNumericTextField = ({
  minValue,
  maxValue,
  addIconButtons = true,
  allowDecimals = true,
  allowNegatives = false,
  afterChange,
  initialValue,
  maxSigDigits = 6,
  ...props
}: BoundedNumericTextFieldProps) => {
  const [textFieldValue, setTextFieldValue] = useState<string>(
    initialValue || ""
  );
  const ref = useRef<HTMLInputElement | null>(null);

  const stringIsEmpty = (value: string) => {
    return value === "";
  };
  const isAllZerosNum = /^0*\.?0*$/;
  const isFloatNum = /^-?[0-9]*\.?[0-9]*$/;
  const isIntegerNum = /^-?[0-9]+$/;
  const skipMinMaxCheck = (value: string) => {
    const lastIndexIsDecimal = value.charAt(value.length - 1) === ".";
    const isEmpty = stringIsEmpty(value);
    const isAllZeros = isAllZerosNum.test(value);
    const isInteger = isIntegerNum.test(value);
    // skipping minMax on all 0s allows values less than 1 to be entered

    return lastIndexIsDecimal || isEmpty || (isAllZeros && !isInteger);
  };

  const setMinMaxValue = (value: string): string => {
    if (skipMinMaxCheck(value)) return value;
    const valueNum = Number(value);

    const boundedNum = setNumberWithinBounds(valueNum, minValue, maxValue);

    const numberInBounds = boundedNum === valueNum;
    return numberInBounds ? value : boundedNum.toString();
  };

  const getSigDigits = (number: string) => {
    if (isIntegerNum.test(number)) return 0;
    const decimalSplit = number.split(".");
    return decimalSplit[decimalSplit.length - 1].length;
  };

  const sigDigitsExceeded = (number: string, sigDigits: number) => {
    return getSigDigits(number) > sigDigits;
  };

  const filterTypes = (value: string) => {
    if (allowDecimals === false) value = value.replace(".", "");
    if (allowNegatives === false) value = value.replace("-", "");
    if (sigDigitsExceeded(value, maxSigDigits)) {
      value = value.substring(0, value.length - 1);
    }
    return value;
  };
  const filterValue = (value: string) => {
    if (stringIsEmpty(value)) return "";
    value = filterTypes(value);
    if (isFloatNum.test(value)) {
      return setMinMaxValue(value);
    }
    return textFieldValue;
  };

  const listeners = (e: eventType) => {
    const newValue = filterValue(e.target.value);
    setTextFieldValue(newValue);
    if (afterChange) afterChange(newValue);
  };

  const changeValueWithIncDecButton = (changeAmount: number) => {
    const changedValue = (+textFieldValue + changeAmount).toString();
    const inBoundsValue = setMinMaxValue(changedValue);
    setTextFieldValue(inBoundsValue);
    if (afterChange) afterChange(inBoundsValue);
  };

  const formatValueOnBlur = (e: eventType) => {
    let value = e.target.value;
    if (stringIsEmpty(value) || value === ".") {
      setTextFieldValue("");
      return;
    }

    value = setMinMaxValue(value);
    value = removeTrailingZeros(value);
    if (isAllZerosNum.test(value)) value = minValue.toString();

    setTextFieldValue(value);
  };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { onChange, ...noChangeProps } = { ...props };
  return (
    <CustomInput
      {...noChangeProps}
      InputProps={{
        ...props?.InputProps,
        endAdornment: addIconButtons ? (
          <InputAdornment position="end">
            <IconButton size="small" onClick={() => changeValueWithIncDecButton(1)}>
              <AddIcon sx={{
                color: 'white'
              }} />{" "}
            </IconButton>
            <IconButton size="small" onClick={() => changeValueWithIncDecButton(-1)}>
              <RemoveIcon sx={{
                color: 'white'
              }} />{" "}
            </IconButton>
          </InputAdornment>
        ) : (
          <></>
        ),
      }}
      onChange={e => listeners(e as eventType)}
      onBlur={e => {
        formatValueOnBlur(e as eventType);
      }}
      autoComplete="off"
      value={textFieldValue}
      inputRef={ref}
    />
  );
};

export default BoundedNumericTextField;
