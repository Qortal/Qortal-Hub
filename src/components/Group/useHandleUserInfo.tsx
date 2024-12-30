import React, { useCallback, useEffect, useState } from "react";
import { getBaseApiReact } from "../../App";
import { useRecoilState, useSetRecoilState } from "recoil";
import { addressInfoControllerAtom } from "../../atoms/global";



export const useHandleUserInfo = () => {
  const [userInfo, setUserInfo] = useRecoilState(addressInfoControllerAtom);



  const getIndividualUserInfo = useCallback(async (address)=> {
    try {
      if(!address || userInfo[address]) return
      const url = `${getBaseApiReact()}/addresses/${address}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("network error");
    }
    const data = await response.json();
    setUserInfo((prev)=> {
      return {
        ...prev,
        [address]: data
      }
    })
    } catch (error) {
        //error
    }
  }, [userInfo])

  return {
    getIndividualUserInfo,
  };
};
