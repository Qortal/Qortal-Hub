import { Typography, TypographyProps } from '@mui/material';

export const ErrorText: React.FunctionComponent<TypographyProps> = ({
  ...props
}) => {
  return <Typography color="error" {...props} />;
};
