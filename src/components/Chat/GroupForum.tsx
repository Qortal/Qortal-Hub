import { useEffect, useState } from 'react';
import { GroupMail } from '../Group/Forum/GroupMail';

export const GroupForum = ({
  selectedGroup,
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
        flex: 1,
        flexDirection: 'column',
        height: '100%',
        left: hide && '-1000px',
        minHeight: 0,
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
        secretKey={secretKey}
        defaultThread={defaultThread}
        setDefaultThread={setDefaultThread}
      />
    </div>
  );
};
