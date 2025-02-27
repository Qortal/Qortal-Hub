import React from 'react'
import './barSpinner.css'
export const BarSpinner = ({width = '20px', color}) => {
  return (
    <div style={{
        width,
        color: color || 'green'
    }} className="loader-bar"></div>
  )
}
