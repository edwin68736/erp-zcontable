interface PlaceholderProps {
  title: string;
}

const Placeholder = ({ title }: PlaceholderProps) => {
  return (
    <div className="space-y-6 pt-2">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight">{title}</h1>
          <p className="text-slate-500 mt-1 text-sm font-medium">
            Esta vista está en construcción.
          </p>
        </div>
      </div>
      
      <div className="bg-white rounded-[2rem] p-8 shadow-sm border border-slate-100 flex items-center justify-center h-64">
        <div className="text-center text-slate-400">
          <i className="fas fa-tools text-4xl mb-4"></i>
          <p>Próximamente</p>
        </div>
      </div>
    </div>
  );
};

export default Placeholder;
