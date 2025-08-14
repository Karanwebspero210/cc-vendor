import React from "react";
import { useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import { getToken } from "../utils/storage";

const NotFound = () => {
  const navigate = useNavigate();
  const auth = useSelector((state) => state.auth);
  const isAuth = auth?.isAuth || Boolean(getToken());

  const handleBackAction = () => {
    navigate(isAuth ? "/products" : "/login");
  };

  return (
    <div className="flex items-center justify-center h-screen bg-gray-100">
      <div className="text-center p-4">
        <h1 className="text-3xl font-semibold text-red-500">
          Ooops...error 404
        </h1>
        <p className="mt-2 text-lg font-medium">
          Sorry, but the page you are looking for doesn't exist.
        </p>

        <div className="mt-4">
          <button
            onClick={handleBackAction}
            className="bg-black text-white font-semibold py-2 px-4 rounded-md max-w-xs w-full hover:cursor-pointer transition duration-300"
          >
            {isAuth ? "Go back to Dashboard" : "Go back to login"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
