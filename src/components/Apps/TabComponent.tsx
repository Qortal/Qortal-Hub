import React from 'react'
import { TabParent } from './Apps-styles'
import NavCloseTab from "../../assets/svgs/NavCloseTab.svg";
import { getBaseApiReact } from '../../App';
import { Avatar, ButtonBase } from '@mui/material';
import LogoSelected from "../../assets/svgs/LogoSelected.svg";
import { executeEvent } from '../../utils/events';
import LockIcon from "@mui/icons-material/Lock";

const TabComponent = ({isSelected, app}) => {
  return (
    <ButtonBase onClick={()=> {
        if(isSelected){
            executeEvent('removeTab', {
                data: app
            })
            return
        }
        executeEvent('setSelectedTab', {
            data: app
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
       {app?.isPrivate && !app?.privateAppProperties?.logo ? (
          <LockIcon
            sx={{
              height: "28px",
              width: "28px",
            }}
          />
        ) : (
          <Avatar
            sx={{
              height: "28px",
              width: "28px",
            }}
            alt={app?.name}
            src={app?.privateAppProperties?.logo ? app?.privateAppProperties?.logo :`${getBaseApiReact()}/arbitrary/THUMBNAIL/${
              app?.name
            }/qortal_avatar?async=true`}
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
        )}
    </TabParent>
    </ButtonBase>
  )
}

export default TabComponent