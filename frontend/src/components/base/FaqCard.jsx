const FaqCard = ({ faqData = [] }) => {
  return (
    <div className="mx-auto h-[300px] p-6 border border-black rounded-2xl bg-white">
      <h2 className="text-lg font-semibold text-gray-800 mb-6">
        How our portal make sku's?
      </h2>
      <div className="space-y-4 h-[200px] overflow-y-auto ">
        {faqData.map((faq, index) => (
          <div key={index} className="border-b border-gray-200 pb-4 mb-4">
            <h5 className="text-sm font-medium text-neutral-700 mb-2">
              {faq.title}
            </h5>
            <p className="text-gray-600 text-sm leading-relaxed">
              {faq.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FaqCard;
