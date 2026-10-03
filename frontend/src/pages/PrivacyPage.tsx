export default function PrivacyPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <p className="text-base text-gray-400 mt-2">Legal</p>
      <h1 className="text-4xl font-serif text-gray-900 mb-2">개인정보처리방침</h1>
      <p className="text-sm text-gray-400 mb-10">최종 수정일: 2026년 10월 3일</p>

      <div className="space-y-10 text-gray-700 text-sm leading-relaxed">

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">1. 수집하는 개인정보 항목</h2>
          <p className="mb-2">ArtLink는 서비스 제공을 위해 아래와 같은 정보를 수집합니다.</p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>회원가입 시(이메일 가입): 이메일 주소, 비밀번호(암호화 저장), 이름, 휴대폰번호, 역할(아티스트 · 갤러리 · 일반)</li>
            <li>소셜 로그인(카카오) 시: 카카오 회원 식별자, 닉네임, 이메일, 프로필 이미지(제공에 동의한 항목)</li>
            <li>갤러리 등록 시: 갤러리명, 주소, 전화번호, 대표자명, 대표 이미지, (선택)이메일·인스타그램 주소</li>
            <li>포트폴리오 등록 시: 전시 이력, 작가 약력, 작품 사진</li>
            <li>공모 지원 시: 작가 약력, 경력, 작품 사진, 포트폴리오 파일, 공모별 추가 답변 (초대 수락·초대 코드 참여 시에는 홈페이지(포트폴리오)에 등록된 약력·경력·작품 사진·포트폴리오 파일)</li>
            <li>서비스 이용 과정에서 자동 생성: 접속 로그, 조회 기록, 일간 방문자 집계를 위한 기기 식별값(브라우저에 저장되는 무작위 값으로, 이름·연락처·IP 주소와 연결하지 않습니다), 포트폴리오 PDF 저장 기록(저장한 날짜·쪽수·작품 수·저장 방식 — 만든 파일은 회원이 ‘내 홈페이지에도 올리기’를 고른 경우에만 서버에 보관됩니다)</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">2. 수집 및 이용 목적</h2>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>회원 식별 및 서비스 로그인</li>
            <li>갤러리-아티스트 매칭 서비스 제공</li>
            <li>공모 지원·심사·결과 안내, 전시 운영 및 정산 지원</li>
            <li>문의 응대, 알림 발송, 서비스 개선</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">3. 보유 및 이용 기간</h2>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>회원 정보: 회원 탈퇴 시까지. 탈퇴 시 계정 식별정보(이메일·이름·연락처 등)는 지체 없이 익명화·파기합니다.</li>
            <li>공모 지원서·전시 운영·판매/정산 기록: 거래 사실 확인 및 분쟁 대응, 관계 법령상 보존 의무를 위해 탈퇴 후에도 필요한 기간 동안 보관될 수 있습니다.</li>
            <li>관계 법령(전자상거래법 등)에 따라 보존이 필요한 경우 해당 기간 동안 보관 후 파기합니다.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">4. 개인정보 처리 위탁 및 제3자 제공</h2>
          <p className="mb-2 text-gray-600">ArtLink는 안정적인 서비스 제공을 위해 아래 업체에 개인정보 처리를 위탁하고 있습니다.</p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>Render (Render Services, Inc.): 서버 호스팅 및 데이터베이스 운영</li>
            <li>Cloudflare (Cloudflare, Inc. — R2): 업로드 이미지·파일 저장</li>
            <li>Kakao (주식회사 카카오): 소셜 로그인 인증</li>
          </ul>
          <p className="mt-3 mb-2 text-gray-600">작가 회원이 공모에 지원하거나 초대 수락·초대 코드로 참여하면, 작가 지원 약관에 대한 동의에 따라 아래와 같이 제공됩니다.</p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>제공받는 자: 해당 공모를 등록한 갤러리 회원(아트링크가 주최하는 공모는 운영을 맡은 갤러리 회원)</li>
            <li>제공 항목: 닉네임, 이름, 이메일, 휴대폰번호, 약력, 경력, 작품 사진, 포트폴리오 파일, 공모별 추가 답변</li>
            <li>이용 목적: 지원자 검토·선정·연락, 전시 운영 및 정산</li>
            <li>보유 기간: 해당 공모의 운영 및 정산이 끝날 때까지(분쟁 대응을 위한 기록은 3항에 따릅니다)</li>
          </ul>
          <p className="mt-3 text-gray-600">위 위탁과 제공 외에는 원칙적으로 이용자의 개인정보를 제3자에게 제공하지 않으며, 이용자의 동의가 있거나 법령에 의한 경우에 한해 예외로 합니다.</p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">5. 이용자의 권리와 행사 방법</h2>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>개인정보 열람·수정·삭제·처리정지를 요청할 수 있습니다.</li>
            <li>회원 탈퇴 시 계정 식별정보는 지체 없이 파기되며, 법령·거래 기록 보존이 필요한 항목은 해당 기간 보관 후 파기됩니다.</li>
          </ul>
        </section>

        <section id="data-deletion">
          <h2 className="text-lg font-semibold text-gray-900 mb-3">6. 데이터 삭제 요청</h2>
          <p className="mb-2 text-gray-600">이용자는 아래 방법으로 본인의 데이터 삭제를 요청할 수 있습니다.</p>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>회원 탈퇴: 마이페이지에서 직접 처리 (계정 식별정보는 지체 없이 파기)</li>
            <li>이메일 요청: <a href="mailto:artlink.aws@gmail.com" className="text-gray-900 underline">artlink.aws@gmail.com</a> 으로 요청 시 7일 이내 처리</li>
          </ul>
          <p className="mt-3 text-gray-600 text-xs">
            To request deletion of your data, please email us at artlink.aws@gmail.com or withdraw your account from My Page.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">7. 개인정보 보호책임자</h2>
          <p className="text-gray-600">
            개인정보 처리에 관한 문의는 아래로 연락해주세요.<br />
            개인정보 보호책임자: 정현오<br />
            이메일: <a href="mailto:artlink.aws@gmail.com" className="text-gray-900 underline">artlink.aws@gmail.com</a>
          </p>
        </section>

      </div>
    </div>
  );
}
