import { Button, InputAdornment, TextField, TextFieldProps, styled } from "@mui/material";
import React, { forwardRef, useState } from 'react'

export const CustomInput = styled(TextField)({
    width: "183px", // Adjust the width as needed
    borderRadius: "5px",
    // backgroundColor: "rgba(30, 30, 32, 1)",
    outline: "none",
    input: {
        fontSize: 10,
        fontFamily: "Inter",
        fontWeight: 400,
        color: "white",
        "&::placeholder": {
            fontSize: 16,
            color: "rgba(255, 255, 255, 0.2)",
        },
        outline: "none",
        padding: "10px",
    },
    "& .MuiOutlinedInput-root": {
        "& fieldset": {
            border: '0.5px solid rgba(255, 255, 255, 0.5)',
        },
        "&:hover fieldset": {
            border: '0.5px solid rgba(255, 255, 255, 0.5)',
        },
        "&.Mui-focused fieldset": {
            border: '0.5px solid rgba(255, 255, 255, 0.5)',
        },
    },
    "& .MuiInput-underline:before": {
        borderBottom: "none",
    },
    "& .MuiInput-underline:hover:not(.Mui-disabled):before": {
        borderBottom: "none",
    },
    "& .MuiInput-underline:after": {
        borderBottom: "none",
    },
});


export const PasswordField = forwardRef<HTMLInputElement, TextFieldProps>( ({ ...props }, ref) => {
    const [canViewPassword, setCanViewPassword] = useState(false);
    return (
            <CustomInput
                type={canViewPassword ? 'text' : 'password'}
                InputProps={{
                    endAdornment: (
                        <InputAdornment position="end" data-testid="toggle-view-password-btn" onClick={() => {
                            setCanViewPassword((prevState) => !prevState)
                        }}>
                            {canViewPassword ? <Button data-testid="plain-text-indicator" sx={{ minWidth: 0, p: 0 }}>👁️</Button> : <Button data-testid="password-text-indicator" sx={{ minWidth: 0, p: 0 }}>👁️‍🗨️</Button>}
                        </InputAdornment>
                    )
                }}
                inputRef={ref}
                {...props}
            />
    )
});