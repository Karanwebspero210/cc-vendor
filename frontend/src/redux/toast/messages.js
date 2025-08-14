export const getMessage = (data) => {
  if (data) {
    return {
      type: data?.status || "success",
      msg:
        data?.message ||
        data?.error ||
        "Something went wrong, please try after sometime!",
    };
  } else return null;
};
