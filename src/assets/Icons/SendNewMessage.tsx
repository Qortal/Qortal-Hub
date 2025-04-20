import React from 'react';
import { styled } from '@mui/system';
import { SVGProps } from './interfaces';

// Create a styled container with hover effects
const SvgContainer = styled('svg')({
  '& path': {
    fill: 'rgba(41, 41, 43, 1)', // Default to red if no color prop
  },
});

export const SendNewMessage: React.FC<SVGProps> = ({ color, opacity }) => {
  return (
    <SvgContainer
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3.33271 10.2306C2.88006 10.001 2.89088 9.65814 3.3554 9.46527L16.3563 4.06742C16.8214 3.87427 17.0961 4.11004 16.9689 4.59692L14.1253 15.4847C13.9985 15.9703 13.5515 16.1438 13.1241 15.8705L10.0773 13.9219C9.8629 13.7848 9.56272 13.8345 9.40985 14.0292L8.41215 15.2997C8.10197 15.6946 7.71724 15.6311 7.5525 15.1567L6.67584 12.6326C6.51125 12.1587 6.01424 11.5902 5.55821 11.359L3.33271 10.2306Z"
      />
    </SvgContainer>
  );
};
