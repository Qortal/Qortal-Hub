import { useEffect, useState } from 'react';
import { GroupMail } from '../Group/Forum/GroupMail';

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
  isPrivate,
}) => {
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
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 70px)',
        left: hide && '-1000px',
        opacity: hide ? 0 : 1,
        position: hide ? 'fixed' : 'relative',
        visibility: hide && 'hidden',
        width: '100%',
      }}
    >
      <GroupMail
        isPrivate={isPrivate}
        hide={hide}
        getSecretKey={getSecretKey}
        selectedGroup={selectedGroup}
        userInfo={userInfo}
        secretKey={secretKey}
        defaultThread={defaultThread}
        setDefaultThread={setDefaultThread}
      />
    </div>
  );
};
