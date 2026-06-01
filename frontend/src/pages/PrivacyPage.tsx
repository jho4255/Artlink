export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <p className="text-base text-gray-400 mt-2">Legal</p>
      <h1 className="text-4xl font-serif text-gray-900 mb-2">개인정보처리방침</h1>
      <p className="text-sm text-gray-400 mb-10">최종 수정일: 2026년 5월 30일</p>

      <div className="space-y-10 text-gray-700 text-sm leading-relaxed">

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">1. 수집하는 개인정보 항목</h2>
          <p className="mb-2">ArtLink는 서비스 제공을 위해 아래와 같은 정보를 수집합니다.</p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>회원가입 시: 이메일 주소, 비밀번호(암호화 저장), 이름, 역할(아티스트/갤러리)</li>
            <li>갤러리 등록 시: 갤러리명, 주소, 전화번호, 대표 이미지</li>
            <li>포트폴리오 등록 시: 전시 이력, 작가 약력, 작품 사진</li>
            <li>Instagram 연동 시: Instagram 사용자명, 액세스 토큰, 게시물 이미지 및 영상 URL</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">2. 수집 목적</h2>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>회원 식별 및 서비스 로그인</li>
            <li>갤러리-아티스트 매칭 서비스 제공</li>
            <li>공모 지원 및 결과 안내</li>
            <li>Instagram 피드를 갤러리 상세 페이지에 표시</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">3. Instagram 데이터 처리</h2>
          <p className="mb-2">ArtLink는 갤러리 오너가 자발적으로 연동한 Instagram 계정의 데이터를 아래와 같이 처리합니다.</p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>수집 항목: Instagram 사용자명, 게시물 이미지/영상 URL, 게시 날짜</li>
            <li>사용 목적: 해당 갤러리의 상세 페이지에 최근 게시물 표시</li>
            <li>액세스 토큰은 서버에 암호화하여 저장되며, 갤러리 피드 조회 외 다른 목적으로 사용하지 않습니다</li>
            <li>수집된 Instagram 데이터는 제3자에게 판매하거나 광고 목적으로 사용하지 않습니다</li>
            <li>Instagram 연동 해제 시 액세스 토큰 및 관련 정보는 즉시 삭제됩니다</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">4. 보관 기간</h2>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>회원 정보: 회원 탈퇴 시까지</li>
            <li>Instagram 연동 정보: 연동 해제 또는 회원 탈퇴 시 즉시 삭제</li>
            <li>관계 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">5. 제3자 제공</h2>
          <p className="text-gray-600">ArtLink는 원칙적으로 이용자의 개인정보를 제3자에게 제공하지 않습니다. 단, 이용자의 동의가 있거나 법령에 의한 경우는 예외로 합니다.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">6. 이용자의 권리</h2>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>개인정보 열람, 수정, 삭제 요청 가능</li>
            <li>Instagram 연동 해제는 마이페이지에서 직접 처리 가능</li>
            <li>회원 탈퇴 시 모든 개인정보 삭제</li>
          </ul>
        </section>

        <section id="data-deletion">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">7. 데이터 삭제 요청</h2>
          <p className="mb-2 text-gray-600">이용자는 아래 방법으로 본인의 데이터 삭제를 요청할 수 있습니다.</p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>Instagram 연동 해제: 마이페이지 → 갤러리 카드 → Instagram 연동 해제 (즉시 삭제)</li>
            <li>회원 탈퇴: 마이페이지에서 직접 처리 (모든 개인정보 즉시 삭제)</li>
            <li>이메일 요청: <a href="mailto:artlink.aws@gmail.com" className="text-gray-900 underline">artlink.aws@gmail.com</a> 으로 요청 시 7일 이내 처리</li>
          </ul>
          <p className="mt-3 text-gray-600 text-xs">
            To request deletion of your data, please email us at artlink.aws@gmail.com or disconnect your Instagram account from My Page.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">8. 개인정보 보호책임자</h2>
          <p className="text-gray-600">
            개인정보 처리에 관한 문의는 아래로 연락해주세요.<br />
            이메일: <a href="mailto:artlink.aws@gmail.com" className="text-gray-900 underline">artlink.aws@gmail.com</a>
          </p>
        </section>

      </div>
    </div>
  );
}
