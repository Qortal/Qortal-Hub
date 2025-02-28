import React, { useCallback,  useRef } from "react";
import { getBaseApiReact } from "../../App";



export const useHandleUserInfo = () => {
  const userInfoRef = useRef({})


  const getIndividualUserInfo = useCallback(async (address)=> {
    try {
      if(!address) return null
      if(userInfoRef.current[address] !== undefined) return userInfoRef.current[address]

      const url = `${getBaseApiReact()}/addresses/${address}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("network error");
    }
    const data = await response.json();
    userInfoRef.current = {
      ...userInfoRef.current,
      [address]: data?.level
    }
    return data?.level
    } catch (error) {
        //error
    }
  }, [])

  return {
    getIndividualUserInfo,
  };
};
