import React from 'react'
import { TabParent } from './Apps-styles'
import NavCloseTab from "../../assets/svgs/NavCloseTab.svg";
import { getBaseApiReact } from '../../App';
import { Avatar, ButtonBase } from '@mui/material';
import LogoSelected from "../../assets/svgs/LogoSelected.svg";
import { executeEvent } from '../../utils/events';

export const AppsDevModeTabComponent = ({isSelected, app}) => {
  return (
    <ButtonBase onClick={()=> {
        if(isSelected){
            executeEvent('removeTabDevMode', {
                data: app
            })
            return
        }
        executeEvent('setSelectedTabDevMode', {
            data: app,
            isDevMode: true
        })
    }}>
    <TabParent sx={{
        border: isSelected && '1px solid #FFFFFF'
    }}>
        {isSelected && (
            
            <img style={
                {
                    position: 'absolute',
                    top: '-5px',
                    right: '-5px',
                    zIndex: 1
                }
            } src={NavCloseTab}/>
           
        ) }
           <Avatar
                          sx={{
                            height: "28px",
                            width: "28px",
                          }}
                          alt=''
                          src={``}
                        >
                          <img
                            style={{
                              width: "28px",
                              height: "auto",
                            }}
                            src={LogoSelected}
                            alt="center-icon"
                          />
                        </Avatar>
    </TabParent>
    </ButtonBase>
  )
}

