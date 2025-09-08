import CtaCard from "../../components/action/CtaCard";
import MenuOutlinedIcon from "@mui/icons-material/MenuOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import HourglassBottomOutlinedIcon from "@mui/icons-material/HourglassBottomOutlined";

import { Grid } from "@mui/material"; // Import Grid from Material UI
import RecentSyncs from "../../components/action/RecentSyncs";
import FaqCard from "../../components/base/FaqCard";

import { useSelector, useDispatch } from "react-redux";
// import * as syncJobsActions from "../../redux/listJobs/actions";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as dashboardActions from "../../redux/dashboard/actions";

const faqData = [
  {
    title: "Choosing the Prefix for SKU",
    description:
      "By analyzing the SKUs of current Shopify products, we extract the prefix 'noxa' from them.",
  },
  {
    title: "Appending the Product ID from the Vendor API",
    description:
      "We append the product ID from the vendor API to the prefix, followed by an underscore (_).",
  },
  {
    title: "Appending the Color and Size",
    description:
      "After the product ID, we append the color and size to the SKU.",
  },
  {
    title: "Example of the SKU",
    description: "noxa_123_red_00",
  },
];

const Dashboard = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  useEffect(() => {
    dispatch(dashboardActions.dashboardInfo());
  }, []);

  const { progressDetails } = useSelector((state) => state.listJobs);
  const { isDashboard } = useSelector((state) => state.dashboard);

  console.log(progressDetails, "progressDetails");
  console.log(isDashboard,"sadsfdasfd")

  const TOTAL_PRODUCTS = isDashboard?.data?.totals?.totalProducts;
  const TOTAL_VARIANTS = isDashboard?.data?.totals?.totalVariants;

  const STORE_NAME = localStorage.setItem("storeName", isDashboard?.data?.stores[0]?.name);

  const safeProgress = Array.isArray(progressDetails) ? progressDetails : [];
  const avgDuration = safeProgress.length
    ? safeProgress.reduce(
        (acc, { duration = 0 }) => acc + (Number(duration) || 0),
        0
      ) /
      safeProgress.length /
      60000
    : 0;

  // Calculate average success rate
  const avgSuccessRate = safeProgress.length
    ? safeProgress.reduce(
        (acc, { successRate = 0 }) => acc + (Number(successRate) || 0),
        0
      ) / safeProgress.length
    : 0;

  const cards = [
    {
      title: "Total Products",
      description: "Total number of products by Vendor",
      value: TOTAL_PRODUCTS,
      valueColor: "Black",
      icon: <MenuOutlinedIcon sx={{ fontSize: 28, color: "gray" }} />,
      onClick: () => {
        navigate("/nox-inventory");
      },
    },
    {
      title: "Total Variants",
      description: "Total number of variants made from products",
      value: TOTAL_VARIANTS,
      valueColor: "#e94949",
      icon: <Inventory2OutlinedIcon sx={{ fontSize: 28, color: "gray" }} />,
      onClick: () => {
        navigate("/nox-inventory");
      },
    },
    {
      title: "Sync Success Rate",
      description: "Average success rate of syncing products",
      value: `${avgSuccessRate.toFixed(2)}%`,
      icon: <CheckCircleOutlinedIcon sx={{ fontSize: 28, color: "gray" }} />,
      onClick: () => {
        navigate("/jobs");
      },
    },
    {
      title: "Job Completion Time ",
      description: "Average time taken complete a sync job",
      value: `${avgDuration.toFixed(2)} mins`,
      icon: (
        <HourglassBottomOutlinedIcon sx={{ fontSize: 28, color: "gray" }} />
      ),
      onClick: () => {
        navigate("/jobs");
      },
    },
  ];

  return (
    <div className="flex flex-col p-6 justify-between h-full ">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-neutral-600">
          Real-time inventory synchronization overview
        </p>
      </div>
      <div>
        <Grid container spacing={2} mt={2}>
          {cards.map((card, index) => (
            <Grid item key={index} xs={12} sm={6} md={3} lg={3} xl={3}>
              <CtaCard
                title={card.title}
                description={card.description}
                value={card.value}
                valueColor={card.valueColor}
                icon={card.icon}
                onClick={card.onClick}
              />
            </Grid>
          ))}
        </Grid>
      </div>
      <div className="mt-4">
        <RecentSyncs />
      </div>
      <div className="mt-4">
        <FaqCard faqData={faqData} />
      </div>
    </div>
  );
};

export default Dashboard;
