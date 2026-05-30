import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6 py-20">
      <p className="text-6xl font-bold text-gray-900 tracking-tight">404</p>
      <h1 className="mt-4 text-xl font-semibold text-gray-900">페이지를 찾을 수 없습니다</h1>
      <p className="mt-2 text-sm text-gray-500 leading-relaxed">
        요청하신 주소가 잘못되었거나, 페이지가 삭제되었을 수 있습니다.
      </p>
      <Link
        to="/"
        className="mt-8 inline-flex items-center px-6 py-3 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
      >
        홈으로 돌아가기
      </Link>
    </div>
  );
}
