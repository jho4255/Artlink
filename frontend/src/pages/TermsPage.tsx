export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <p className="text-base text-gray-400 mt-2">Legal</p>
      <h1 className="text-4xl font-serif text-gray-900 mb-2">이용약관</h1>
      <p className="text-sm text-gray-400 mb-10">최종 수정일: 2026년 7월 7일</p>

      <div className="space-y-10 text-gray-700 text-sm leading-relaxed">

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">제1조 (목적)</h2>
          <p className="text-gray-600">
            이 약관은 (주)아트링크(이하 &ldquo;회사&rdquo;)가 제공하는 갤러리-아티스트 매칭 플랫폼 ArtLink(이하 &ldquo;서비스&rdquo;)의
            이용과 관련하여 회사와 이용자 간의 권리·의무 및 책임사항, 이용 조건 및 절차를 규정함을 목적으로 합니다.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">제2조 (정의)</h2>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>&ldquo;이용자&rdquo;란 이 약관에 따라 서비스를 이용하는 회원을 말합니다.</li>
            <li>&ldquo;아티스트 회원&rdquo;이란 포트폴리오를 등록하고 공모에 지원하는 회원을 말합니다.</li>
            <li>&ldquo;갤러리 회원&rdquo;이란 갤러리·공모·전시를 등록하고 운영하는 회원을 말합니다.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">제3조 (약관의 효력 및 변경)</h2>
          <p className="text-gray-600">
            이 약관은 서비스 화면에 게시함으로써 효력이 발생합니다. 회사는 관계 법령을 위반하지 않는 범위에서 약관을 변경할 수 있으며,
            변경 시 적용일자와 변경사유를 명시하여 사전에 공지합니다.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">제4조 (회원가입 및 자격)</h2>
          <p className="text-gray-600">
            이용자는 회사가 정한 가입 양식에 정보를 기입하고 이 약관 및 개인정보처리방침에 동의함으로써 회원가입을 신청합니다.
            타인의 정보를 도용하거나 허위 정보를 기재한 경우 서비스 이용이 제한될 수 있습니다.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">제5조 (서비스의 내용 및 회사의 지위)</h2>
          <p className="text-gray-600 mb-2">
            회사는 아티스트와 갤러리를 연결하는 온라인 중개 플랫폼을 제공합니다. 공모 지원, 참여 작가 선정,
            전시 운영 등 개별 거래·활동은 아티스트 회원과 갤러리 회원 사이에서 이루어지며,
            <strong className="text-gray-800"> 회사는 해당 거래의 당사자가 아닙니다.</strong>
          </p>
          <p className="text-gray-600">
            따라서 회사는 회원 간 거래와 관련한 분쟁에 대해 개입할 의무가 없으며, 각 회원이 등록한 정보·게시물·거래 내용에 대한
            책임은 이를 등록한 회원에게 있습니다. 다만 회사는 원활한 거래 지원을 위해 필요한 도구와 정보를 제공하기 위해 노력합니다.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">제6조 (회원의 의무)</h2>
          <ul className="list-disc list-inside space-y-1 text-gray-600">
            <li>타인의 정보를 도용하거나 허위 사실을 등록하지 않습니다.</li>
            <li>회사 및 제3자의 저작권 등 지식재산권을 침해하지 않습니다.</li>
            <li>서비스 운영을 방해하거나 법령·공서양속에 반하는 행위를 하지 않습니다.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">제7조 (게시물의 저작권 및 관리)</h2>
          <p className="text-gray-600">
            회원이 등록한 포트폴리오·작품 사진·전시 자료 등의 저작권은 해당 회원에게 있습니다. 회원은 서비스 노출에 필요한 범위에서
            회사가 게시물을 사용(표시, 복제, 편집 등)하는 것에 동의합니다. 회사는 법령 위반 또는 타인의 권리를 침해하는 게시물을
            사전 통지 없이 삭제하거나 노출을 제한할 수 있습니다.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">제8조 (서비스 이용 제한 및 탈퇴)</h2>
          <p className="text-gray-600">
            회원은 언제든지 마이페이지에서 회원 탈퇴를 신청할 수 있습니다. 회사는 회원이 이 약관을 위반한 경우 서비스 이용을
            제한하거나 회원 자격을 정지·상실시킬 수 있습니다.
          </p>
        </section>

        {/* ⚠️ 자동 처리 규칙의 **정본**. 규칙을 바꾸면 코드 상수(AUTO_APPROVE_DAYS·STALE_AFTER_DAYS·
            NOTIFICATION_TTL_MS)와 여기, 그리고 시점별 약관(public/terms/*.txt)을 함께 고쳐야 한다.
            한 곳만 고치면 화면과 약관이 어긋난 채로 남는다. */}
        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">제9조 (자동으로 처리되는 사항)</h2>
          <p className="text-gray-600">
            서비스 운영을 위해 아래 사항은 회원의 별도 조작 없이 자동으로 처리됩니다. 각 항목은 해당 기능을 이용하는
            시점의 안내와 화면에도 표시됩니다.
          </p>
          <ul className="mt-3 space-y-2 text-gray-600 list-disc pl-5">
            <li>
              <b className="text-gray-900">정산 무응답 자동 수락</b> — 갤러리 회원의 정산 확인 요청일로부터
              <b className="text-gray-900"> 3일</b>(한국 시간 달력 기준) 이내에 작가 회원이 수락 또는 이의 제기를 하지 않으면
              해당 정산 내역을 수락한 것으로 처리합니다. 이의를 제기한 경우에는 자동 수락되지 않으며,
              금액이 수정되면 기한이 새로 시작됩니다.
            </li>
            <li>
              <b className="text-gray-900">방치 공모 자동 정리</b> — 전시 종료일로부터 <b className="text-gray-900">20일</b>이
              지날 때까지 정산을 시작하지 않은 공모는 ‘종료된 공모’로 정리되어 진행 중 목록에서 제외됩니다.
              정리 전 5일·10일·15일째에 알림을 보내며, 정리된 뒤에도 정산을 이어서 진행할 수 있고 자료는 삭제되지 않습니다.
            </li>
            <li>
              <b className="text-gray-900">읽은 알림 삭제</b> — 읽음 처리된 알림은 <b className="text-gray-900">90일</b>이
              지나면 자동으로 삭제됩니다.
            </li>
            <li>
              <b className="text-gray-900">이달의 갤러리 노출 종료</b> — 관리자가 지정한 노출 기한이 지나면 자동으로 노출이 종료됩니다.
            </li>
            <li>
              <b className="text-gray-900">업로드 파일 삭제</b> — 이미지를 교체하거나 삭제하면 이전 파일은 저장소에서 함께
              삭제되며 복구되지 않습니다.
            </li>
            <li>
              <b className="text-gray-900">탈퇴 시 게시물 비공개</b> — 회원이 탈퇴하면 해당 회원이 등록한 갤러리·공모·전시는
              공개 목록에서 즉시 제외됩니다.
            </li>
            <li>
              <b className="text-gray-900">정원 및 마감</b> — 모집 정원이 찼거나 마감일이 지난 공모에는 지원할 수 없으며,
              동시에 여러 건이 접수되면 정원을 초과하는 지원은 접수되지 않습니다. 초대를 받은 경우에도 동일하게 적용됩니다.
            </li>
          </ul>
          <p className="mt-3 text-sm text-gray-500">
            위 자동 처리는 정해진 시각에 일괄 실행되는 것이 아니라 서비스 이용 중 해당 조건이 확인되는 시점에 반영됩니다.
            따라서 실제 반영은 기준일보다 늦어질 수 있습니다.
          </p>
          <p className="mt-2 text-sm text-gray-500">
            모든 날짜 기준은 한국 시간(KST) 달력 날짜이며, 기한 당일 자정까지를 포함합니다.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">제10조 (면책)</h2>
          <p className="text-gray-600">
            회사는 천재지변, 회원의 귀책사유, 회원 간 거래 과정에서 발생한 손해에 대해 관계 법령이 허용하는 범위에서 책임을 지지 않습니다.
            회사는 회원이 게시한 정보의 신뢰성·정확성을 보증하지 않습니다.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">제11조 (분쟁 해결 및 준거법)</h2>
          <p className="text-gray-600">
            이 약관은 대한민국 법령에 따라 규율되고 해석되며, 서비스 이용과 관련하여 분쟁이 발생한 경우 회사의 본점 소재지를
            관할하는 법원을 관할 법원으로 합니다.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-3">사업자 정보</h2>
          <p className="text-gray-600">
            상호: (주)아트링크 · 대표: 정현오<br />
            주소: 경기도 고양시 덕양구 화중로 104번길 28, 9층 910호 p09호<br />
            사업자등록번호: 578-86-03858<br />
            문의: <a href="mailto:artlink.aws@gmail.com" className="text-gray-900 underline">artlink.aws@gmail.com</a>
          </p>
          <p className="mt-3 text-xs text-gray-400">
            ※ 본 약관은 표준 양식을 기반으로 작성되었습니다. 정식 서비스 개시 전 법률 전문가의 검토를 권장합니다.
          </p>
        </section>

      </div>
    </div>
  );
}
