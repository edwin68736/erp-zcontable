import PageHeading from '../components/ui/PageHeading';

interface PlaceholderProps {
  title: string;
}

const Placeholder = ({ title }: PlaceholderProps) => {
  return (
    <div className="space-y-3">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <PageHeading hint="Esta vista está en construcción.">{title}</PageHeading>
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
