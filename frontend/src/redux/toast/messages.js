export const getMessage = (data) => {
  if (data) {
    return {
      type: data?.status || "success",
      msg:
        data?.data?.message ||
        data?.error?.message ||
        "Please try after sometime!",
    };
  } else return null;
};
