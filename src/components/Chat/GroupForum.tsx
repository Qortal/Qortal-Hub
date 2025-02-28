import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { GroupMail } from "../Group/Forum/GroupMail";
import { MyContext, isMobile } from "../../App";
import { getRootHeight } from "../../utils/mobile/mobileUtils";






export const GroupForum = ({
  selectedGroup,
  userInfo,
  secretKey,
  getSecretKey,
  isAdmin,
  myAddress,
  hide,
  defaultThread, 
  setDefaultThread,
  isPrivate
}) => {
  const {  rootHeight } = useContext(MyContext);
  const [isMoved, setIsMoved] = useState(false);
  useEffect(() => {
    if (hide) {
      setTimeout(() => setIsMoved(true), 300); // Wait for the fade-out to complete before moving
    } else {
      setIsMoved(false); // Reset the position immediately when showing
    }
  }, [hide]);

  return (
    <div
    style={{
      // reference to change height
      height: isMobile ? `calc(${rootHeight} - 127px` : "calc(100vh - 70px)",
      display: "flex",
      flexDirection: "column",
      width: "100%",
      opacity: hide ? 0 : 1,
      visibility: hide && 'hidden',
      position: hide ? 'fixed' : 'relative',
    left: hide && '-1000px'
    }}
  >
   <GroupMail isPrivate={isPrivate} hide={hide} getSecretKey={getSecretKey} selectedGroup={selectedGroup} userInfo={userInfo} secretKey={secretKey} defaultThread={defaultThread} setDefaultThread={setDefaultThread} />

   </div>
  );
};
