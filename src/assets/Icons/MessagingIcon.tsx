import React from "react";

export const MessagingIcon = ({ color, height = 31, width = 31 }) => {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 31 31"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M26.3937 4.49877C23.6712 1.56681 3.1922 8.74911 3.20912 11.3714C3.22829 14.345 11.2067 15.2597 13.4181 15.8802C14.748 16.2532 15.1041 16.6357 15.4107 18.0302C16.7995 24.3457 17.4967 27.487 19.0859 27.5571C21.6189 27.6691 29.0507 7.36011 26.3937 4.49877Z"
        stroke={color}
        strokeWidth="2"
      />
      <path
        d="M14.4591 16.3076L18.8341 11.9326"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
