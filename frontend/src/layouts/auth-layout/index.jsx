
import AUTHIMG from "../../assets/authsection.jpg";
import COUTURELOGO from "../../assets/couturecandy.png";

const AuthLayout = ({ children }) => {
  return (
    <div className="min-h-screen w-full bg-gray-50 lg:flex">
      <div className="relative hidden min-h-screen flex-1 lg:block">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${AUTHIMG})` }}
        />
      </div>

      <div className="flex min-h-screen w-full flex-1 items-center justify-center bg-white p-6">
        <div className="w-full max-w-md p-6 rounded-md bg-white">
          <div className="mb-6 text-center">
            <img src={COUTURELOGO}/>
            <p className="text-gray-500 text-lg">Vendor Portal</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
};

export default AuthLayout;
