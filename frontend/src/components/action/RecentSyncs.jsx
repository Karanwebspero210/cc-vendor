import React, { useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { Card, CardHeader, CardContent, Box } from "@mui/material";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import * as jobsListingActions from "../../redux/jobs/actions";

const RecentSyncs = () => {
  const dispatch = useDispatch();
  const jobs = useSelector((state) => state.listJobs.jobs);

  useEffect(() => {
    dispatch(jobsListingActions.jobList({ page: 1, limit: 7 }));
  }, [dispatch]);


  const chartData = jobs
    ?.slice() // Checks if jobs and history are defined
    .reverse()
    .slice(0, 7)
    .map((job, index) => {
      const progress = job?.progress || {};
      const { total = 0, completed = 0, failed = 0 } = progress;

      return {
        name: `Job ${index + 1}`,
        total,
        synced: completed,
        failed,
      };
    });

  return (
    <>
      <div className="mx-auto h-[300px] p-6 border border-black rounded-2xl bg-white">
        <h2 className="text-lg font-semibold text-gray-800">
          Recent Sync Overview
        </h2>
        <CardContent>
          <Box sx={{ width: "100%", height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                width={500}
                height={400}
                data={chartData}
                margin={{
                  top: 10,
                  right: 30,
                  left: 0,
                  bottom: 0,
                }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="synced"
                  stroke="#e94949"
                  fill="#e94949"
                  stackId="1"
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="black"
                  fill="black"
                  stackId="1"
                />
              </AreaChart>
            </ResponsiveContainer>
          </Box>
        </CardContent>
      </div>
    </>
  );
};

export default RecentSyncs;
