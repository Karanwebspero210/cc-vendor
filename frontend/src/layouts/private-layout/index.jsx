import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useMemo, useState, useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import { logout as logoutAction } from "../../redux/auth/actions";
import COUTURELOGO from "../../assets/couturecandy.png";
import USERICON from "../../assets/profile-user.png";
import privateRoutes from "../../routes/privateRoutes"; // Import routes dynamically

const PrivateLayout = ({ children, sidebar = [] }) => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const location = useLocation();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setIsUserMenuOpen(false);
      }
    };

    if (isUserMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isUserMenuOpen]);

  // Dynamically generate menuItems from privateRoutes
  const menuItems = useMemo(() => {
    return privateRoutes
      .filter((route) => !route.hidden)
      .map((route) => ({
        id: route.id,
        title: route.title,
        path: route.path,
        icon: route.icon,
      }));
  }, [sidebar]);

  const handleLogout = async () => {
    await dispatch(logoutAction());
    navigate("/login", { replace: true, state: { from: location } });
  };

  return (
    <div className="min-h-screen w-full bg-gray-50 flex">
      {/* Sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col bg-white border-r border-gray-200">
        <div className="h-16 flex items-center px-4 border-b border-gray-200">
          <span className="text-lg font-semibold text-gray-900 p-4">
            <img src={COUTURELOGO} />
          </span>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {menuItems.map((item) => (
            <NavLink
              key={item.id || item.path}
              to={item.path || "#"}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                  isActive
                    ? "bg-black text-white"
                    : "text-gray-700 hover:bg-gray-100"
                }`
              }
            >
              <span className="truncate">{item.title}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top navbar */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-end px-4">
          <div ref={userMenuRef}>
            <button
              type="button"
              className="flex items-center gap-2 rounded-full px-2 py-1 hover:bg-gray-100"
              onClick={() => setIsUserMenuOpen((v) => !v)}
            >
              <img className="h-6" src={USERICON} />
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="w-4 h-4 text-gray-600"
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
                  onClick={() => setIsUserMenuOpen(false)}
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

        {/* Content */}
        <main className="flex-1 p-4">{children}</main>
      </div>
    </div>
  );
};

export default PrivateLayout;
