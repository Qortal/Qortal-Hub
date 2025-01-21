import React from 'react'
import { JoinGroup } from './JoinGroup'

export const GlobalActions = ({memberGroups}) => {
  return (
    <>
    <JoinGroup memberGroups={memberGroups} />
    </>
  )
}
