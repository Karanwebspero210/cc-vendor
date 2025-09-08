import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useMemo, useState, useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import { logout as logoutAction } from "../../redux/auth/actions";
import COUTURELOGO from "../../assets/couturecandy.png";
import USERICON from "../../assets/profile-user.png";
import privateRoutes from "../../routes/privateRoutes";

import CloudSyncIcon from "@mui/icons-material/CloudSync";
import { getStoreName } from "../../utils/storage";

const PrivateLayout = ({ children, sidebar = [] }) => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const location = useLocation();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  const [storeName, setStoreName] = useState("");
 
  useEffect(() => {
    const STORE_NAME = getStoreName();
    console.log(STORE_NAME, "STORE_NAME");
    setStoreName(STORE_NAME);
  }, []);
  // close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setIsUserMenuOpen(false);
      }
    };
    if (isUserMenuOpen)
      document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isUserMenuOpen]);

  // also close when navigating
  useEffect(() => setIsUserMenuOpen(false), [location.pathname]);

  // build sidebar from routes
  const menuItems = useMemo(() => {
    return privateRoutes
      .filter((route) => !route.hidden)
      .map((route) => ({
        id: route.id,
        title: route.title,
        subtitle: route.subtitle,
        path: route.path,
        icon: route.icon,
      }));
  }, [sidebar]);

  const handleLogout = async () => {
    await dispatch(logoutAction());
    navigate("/login", { replace: true, state: { from: location } });
  };

  return (
    <div className="min-h-screen w-full bg-gray-50 flex ">
      {/* page column: header + content */}
      <div className="flex-1 flex flex-col min-w-0 pt-16">
        {/* top navbar */}
        <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-black border-b border-gray-800 flex items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <div className="text-white py-2">
              <h1 className="text-[16px] font-medium">Couture Candy Admin</h1>
            </div>
          </div>

          <div ref={userMenuRef} className="relative">
            <button
              type="button"
              className="flex items-center gap-2 rounded-full px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-white/30"
              onClick={() => setIsUserMenuOpen((v) => !v)}
            >
              <img className="h-6" src={USERICON} alt="User" />
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-4 h-4 text-black"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.135l3.71-3.904a.75.75 0 111.08 1.04l-4.25 4.472a.75.75 0 01-1.08 0L5.25 8.27a.75.75 0 01-.02-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {isUserMenuOpen && (
              <div className="absolute right-0 mt-2 w-40 rounded-md border border-gray-200 bg-white shadow-md z-10">
                <NavLink
                  to="/settings"
                  className={({ isActive }) =>
                    `block px-3 py-2 text-sm ${
                      isActive
                        ? "bg-amber-100 text-amber-800"
                        : "text-gray-700 hover:bg-gray-100"
                    }`
                  }
                >
                  Settings
                </NavLink>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100"
                >
                  Logout
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="flex flex-1 min-h-0 ">
          {/* sidebar */}
          <aside className="hidden md:flex md:w-[223px] md:flex-col bg-white border-r border-gray-200 sticky top-16 h-[calc(100vh-4rem)] overflow-hidden">
            <div className=" flex items-center px-4 py-2 gap-2 border-b border-gray-200">
              <div>
                <CloudSyncIcon sx={{ fontSize: 32, color: "#e94949" }} />
              </div>
              <div>Sync Portal</div>
            </div>
            <nav className="flex-1 p-2 space-y-1 overflow-y-auto overscroll-contain">
              {menuItems.map((item) => (
                <NavLink
                  key={item.id || item.path}
                  to={item.path || "#"}
                  className={({ isActive }) =>
                    `flex flex-col items-left gap-1 rounded-lg px-3 py-2 text-sm ${
                      isActive
                        ? "bg-black text-white"
                        : "text-gray-700 hover:bg-gray-100"
                    }`
                  }
                >
                  <div className="flex items-center gap-2">
                    <div>
                      {item.icon && <item.icon sx={{ fontSize: 20 }} />}
                    </div>
                    <div>
                      <div className="text-sm">{item.title}</div>
                      <div className="text-[11px] text-neutral-500">
                        {item.subtitle}
                      </div>
                    </div>
                  </div>
                </NavLink>
              ))}
            </nav>
            <div className="text-[14px] flex flex-col items-left p-2 border-t border-gray-200">
              <div className="mb-2">
                <p>Store Connected</p>
                <p className="text-[#e94949] text-[16px] font-bold capitalize">
                  {storeName}
                </p>
              </div>
            </div>
          </aside>

          {/* main */}
          <main className="flex-1 p-4 overflow-y-auto overscroll-contain min-w-0">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
};

export default PrivateLayout;
