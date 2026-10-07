"use client";

// Təlimatlar (Versiya 2.78; Tapşırıqlar və Sorğular — 2.79; Çat və Tənzimləmələr — 2.81; təsdiq qaydası — 2.82; şablon papkalarının seçilməsi — 2.83; sabit işlərdə ✓-suz rəngli xanalar — 2.84; rəhbər əməkdaşlarının şəxsi işlərini görür — 2.85; müştəri üzrə sənəd tarixçəsi və qayıtmayan imzalı nüsxələr zəngdə — 2.86; “Sənəd dövriyyəsi” sütunu — 2.87; “Bütün firmalar” seçimi — 2.88; sabit işlərdə hesablama başlanğıcı və icra qeydinin geri götürülməsi — 2.89; sabit işin redaktəsi, silinməsi və cədvəl filtrləri — 2.90; həftəlik işin son tarixi növbəti həftədə — 2.91; işçi rəngləri və həftə tarixlərinin düzəlişi — 2.92; bir “Sabit işlər” bölməsi, rüblük / yarımillik / illik işlər, bir icazə — 2.93; rüblük işin sabit son tarixi, uzun dövrlərin hesablanması və “Əməkdaşlarımın sabit işləri” — 2.94; təyin edilməyən firma xanası boz — 2.95; admin hesabı iş və tapşırıq yaratmır, bölmə görünür — 2.97–2.98; firma üzrə Giriş icazələri və sənəd növləri üzrə qeydiyyat — 2.99; firmalar alt-alta, bütün bölmələr firma üzrə — 2.100; “Başqa firmadan köçür” — 2.101; tamamlanmış işin faylı dəyişir, həvalədə yalnız addımın faylı — 2.102; bir neçə fayl (ən çox 10) — 2.104): how each section works, written into the program. A guide is shown only to those who may open its
// section, and each of its parts only to the audience it is for (everyone, the registrar, department heads, the director, the admin).
// The texts follow what the code does; when a section's rules change, its guide here changes with it.

import { Fragment, useEffect, useState } from "react";
import { Printer, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

type Audience = "all" | "registrar" | "head" | "director" | "admin";
type Block = { p: string } | { steps: string[] } | { list: string[] } | { note: string } | { qa: [string, string][] };
type GuidePart = { audience: Audience; title: string; blocks: Block[] };
type Guide = { id: string; group: string; title: string; path: string; section: string; registrarKey?: string; intro: string; parts: GuidePart[] };

export type GuideContext = {
  isAdmin: boolean;
  // Sections the viewer may open (the same rule as the menu).
  sections: Record<string, boolean>;
  // Section permissions themselves (the registrar of incoming / outgoing documents).
  rights: Record<string, boolean>;
  // The employee the admin is viewing as (İstifadəçi görünüşü), whose head/director roles are asked for.
  viewEmployeeId?: number | null;
};

const AUDIENCE_LABELS: Record<Audience, string> = { all: "Hamı üçün", registrar: "Qeydiyyatçı üçün", head: "Şöbə rəhbəri üçün", director: "Firmanın rəhbəri (direktor) üçün", admin: "Admin üçün" };

const GUIDES: Guide[] = [
  {
    id: "tasks", group: "Tapşırıqlar", title: "Verilən tapşırıqlar", path: "Tapşırıqlar → Verilən tapşırıqlar", section: "tasks.manager",
    intro: "Sizə verilmiş tapşırıqlar: rəhbərin daxil olan sənəd üzrə dərkənarı, rəhbərinizin sizə həvalə etdiyi iş addımları və qəbul edilmiş sorğular. Hər tapşırığın son tarixi, icra ardıcıllığı və qiyməti var.",
    parts: [
      { audience: "all", title: "Statuslar və icra ardıcıllığı", blocks: [
        { steps: [
          "Yeni — tapşırıq sizə düşüb. İşə başlayanda “İcraya al” basın → İcradadır.",
          "İş bitəndə “Təqdim et” basın → Təqdim edilib. Tapşırıqla doldurulmalı fayl göndərilibsə, işlənmiş faylı yükləmədən təqdim etmək olmur. Təqdim edərkən bir neçə fayl seçmək olar (ən çox 10, hər biri 25 MB-a qədər); hər seçim siyahıya əlavə olunur, ✕ ilə siyahıdan çıxarılır.",
          "Tapşırığı verən şəxs işi qəbul edirsə, 1–10 bal verir → Təsdiqlənib. Qəbul etmirsə, səbəbini yazıb geri qaytarır → Geri qaytarılıb; düzəldib yenidən “Təqdim et” basırsınız.",
        ] },
        { note: "Status yalnız bu ardıcıllıqla dəyişir; təqdim edilmiş tapşırığı geri çəkmək olmur. Son tarixi keçmiş aktiv tapşırıq gecikən sayılır və zəngdə (🔔) göstərilir." },
      ] },
      { audience: "all", title: "Tapşırığı kim təsdiqləyir", blocks: [
        { list: [
          "Addımı sizə “Ver” ilə həvalə edən şəxs — onun tapşırığından və ya şəxsi işindən gələn tapşırığı o təsdiqləyir.",
          "Daxil olan sənəd üzrə dərkənarla verilən tapşırığı — firmanın rəhbəri (direktor).",
          "Sorğudan yaranan tapşırığı — sorğunun getdiyi şöbənin rəhbəri, Sorğular bölməsində.",
          "Admin istənilən tapşırığı təsdiqləyə bilər.",
          "Zəncir varsa, hər pillə öz verdiyini təsdiqləyir: əməkdaşın işini onu verən şöbə rəhbəri, şöbə rəhbərinin işini isə ona verən.",
        ] },
      ] },
      { audience: "all", title: "Verdiyiniz tapşırıqları təsdiqləmək", blocks: [
        { steps: [
          "Verdiyiniz tapşırıq təqdim ediləndə Verilən tapşırıqlarda “Təsdiqimi gözləyir” tabı (sayğacla) çıxır.",
          "Tapşırığın işlənmiş faylına və qeydinə baxın, “Qiymətləndir” basın: 1–10 bal və rəy yazıb “Təsdiqlə və qiymətləndir”, və ya səbəbini yazıb “Geri qaytar”.",
          "Eyni şeyi tapşırığınızın (və ya şəxsi işinizin) addımlarında da edə bilərsiniz: həvalə edilmiş addımın altında “… işi təqdim edib — təsdiqinizi gözləyir” bölməsi çıxır — bal seçin, rəy yazın, “Təsdiqlə” və ya “Geri qaytar”.",
        ] },
        { note: "Təsdiqdən sonra həvalə etdiyiniz addımın ✓-u avtomatik qoyulur. Geri qaytaranda səbəb yazmaq məcburidir." },
      ] },
      { audience: "all", title: "Son tarixin dəyişdirilməsi", blocks: [
        { list: [
          "Tapşırığı vaxtında bitirə bilməyəcəksinizsə, tapşırıqdan yeni tarix və səbəb yazaraq tarix dəyişikliyi istəyin.",
          "Hər tapşırıq üçün bunu yalnız bir dəfə və təqdim etməzdən əvvəl etmək olar.",
          "Admin tələbi qəbul edir (öz tarixini də yaza bilər) və ya rədd edir. İlkin tarix tapşırıqda “ilkin tarix” kimi qalır.",
        ] },
      ] },
      { audience: "all", title: "İş addımları və həvalə", blocks: [
        { list: [
          "Tapşırığın içində iş addımları yazıb hər birini ✓ edə, addıma fayl əlavə edə bilərsiniz — 📎 “Fayl” ilə bir dəfəyə bir neçə fayl seçilir (bir addımda ən çox 10), hər faylın yanındakı ✕ onu silir.",
          "Rəhbərsinizsə, addımın yanında tabeliyinizdəki əməkdaşı seçib “Ver” basa bilərsiniz (həvalə) — o addım həmin əməkdaşa ayrıca tapşırıq kimi düşür (addımın faylları ilə). Əməkdaşa yalnız həmin addıma (iş axınına) yüklənmiş fayllar — hamısı — gedir — işin özünə əlavə olunmuş fayl göndərilmir; göndərməzdən əvvəl şərh pəncərəsində hansı faylın gedəcəyi yazılır. Kimə həvalə etmək olar — firmanın strukturu göstərir; boş vəzifə atlanır və onun tabeliyindəkilər təklif olunur.",
          "Həvalə üçün tapşırığın firması təyin olunmalıdır.",
          "Həvalə edilmiş addımın ✓-u əl ilə qoyulmur — əməkdaşın tapşırığını siz təsdiqləyəndə avtomatik qoyulur. Əsas sütunda həvalə zənciri (kim kimə verib) görünür.",
        ] },
      ] },
      { audience: "all", title: "Sorğudan yaranan tapşırıq", blocks: [
        { p: "Şöbə rəhbəri gələn sorğunu sizə verəndə o, burada “Sorğu əsasında” tapşırıq kimi görünür. Təqdim edərkən yazdığınız cavab mətni və fayl sorğunu göndərənə gedir. Belə tapşırığı sorğunu göndərən cavabı təsdiqləyəndən sonra şöbə rəhbəri Sorğular bölməsində qiymətləndirir." },
      ] },
      { audience: "admin", title: "Tapşırıqları yoxlamaq", blocks: [
        { note: "Admin hesabı tapşırıq vermir və şəxsi iş yaratmır: “Şəxsi işlərim” bölməsi görünür, amma ora iş əlavə etmək olmur; tapşırığın addımını da kiməsə həvalə etmək olmur. Tapşırıq vermək lazımdırsa, öz istifadəçi hesabınızla daxil olun. Admin bütün tapşırıqları görür, yoxlayır və tarix tələblərini həll edir." },
        { list: [
          "Təqdim edilmiş tapşırığı “Qiymətləndir” ilə 1–10 balla təsdiqləyin və ya səbəb yazıb geri qaytarın. Həvalə edilmiş və dərkənar tapşırıqlarını adətən onları verən şəxs təsdiqləyir, amma admin də edə bilər.",
          "Tarix dəyişikliyi tələblərini qəbul və ya rədd edin.",
          "Yalnız “Yeni” statuslu tapşırıq silinir. Sorğudan yaranan tapşırıq silinmir — onu Sorğular bölməsindən (icraçını dəyişmək, imtina) idarə edin.",
        ] },
      ] },
    ],
  },
  {
    id: "personal", group: "Tapşırıqlar", title: "Şəxsi işlərim", path: "Tapşırıqlar → Şəxsi işlərim", section: "tasks.mine",
    intro: "Özünüz üçün yazdığınız işlər və onların iş axını (addımlar). Addımı tabeliyinizdəki əməkdaşa həvalə edə və ya başqa şöbəyə sorğu kimi göndərə bilərsiniz. İşlərinizi siz, firmanın strukturuna görə rəhbərləriniz (şöbə rəisi, direktor) və admin görür — rəhbər yalnız baxır və qeyd yaza bilər.",
    parts: [
      { audience: "all", title: "İşin gedişi", blocks: [
        { steps: [
          "“Əlavə et”: işin adı, açıqlaması, firması, son tarixi (istəyə bağlı), fayllar (bir neçə fayl seçmək olar — ən çox 10, hər biri 25 MB-a qədər).",
          "İş axınına addımlar əlavə edin.",
          "İşə başlayanda “İcraya al” → İcradadır. Addımlar yalnız icradakı işdə ✓ edilir.",
          "Bütün addımlar ✓ olanda iş avtomatik “Tamamlanıb” olur. Addımı olmayan işi “Tamamla” ilə bitirirsiniz.",
        ] },
        { list: [
          "Yalnız “Yeni” statuslu iş silinir; tamamlanmış işin adı, açıqlaması, firması və son tarixi dəyişmir və ona addım əlavə olunmur.",
          "İşin fayllarını istənilən statusda dəyişmək olar: “Yeni” və “İcradadır”da “Redaktə et” ilə (köhnə faylı ✕ ilə silin, yenilərini seçin), tamamlanmış işdə isə “Aç” pəncərəsində — faylın yanındakı ✕ və “Fayl əlavə et”. Dəyişiklik işin tarixçəsinə yazılır.",
          "“Aç” pəncərəsində işin tarixçəsi var: yaradılma, addımlar, həvalələr, sorğular, təsdiqlər, rəhbərin qeydləri.",
        ] },
        { note: "Admin hesabı bu bölməni görür, amma iş əlavə etmir, addımı həvalə etmir və şöbəyə sorğu göndərmir — bunu öz istifadəçi hesabınızdan edin." },
        { note: "İşləriniz rəhbərlərinizə görünür. Rəhbər işi dəyişə, silə və ya addımlara ✓ qoya bilməz; yazdığı qeyd işin tarixçəsində “Rəhbərin qeydi” kimi çıxır." },
      ] },
      { audience: "all", title: "Addımı başqasına vermək", blocks: [
        { list: [
          "Həvalə: addımın yanında tabeliyinizdəki əməkdaşı seçib “Ver” basın — addım ona tapşırıq kimi düşür (Verilən tapşırıqlar). Əməkdaş təqdim edəndə onu siz təsdiqləyirsiniz (addımın altında və ya “Təsdiqimi gözləyir” tabında) — bundan sonra addımın ✓-u avtomatik qoyulur.",
          "“Şöbəyə sorğu” — addım işin firmasının başqa şöbəsinə sorğu kimi gedir (Sorğular). İş icrada olmalı və firması seçilməlidir. Addımın faylı sorğuya da gedir.",
          "Sorğu açıq olduğu müddətdə addımı silmək, həvalə etmək və ya yenidən göndərmək olmur. Cavabı təsdiqləyəndə addımın ✓-u avtomatik qoyulur.",
        ] },
      ] },
      { audience: "head", title: "Əməkdaşlarımın işləri", blocks: [
        { p: "Tabeliyinizdə əməkdaş varsa, Şəxsi işlərimin yuxarısında tablar görünür: “Mənim işlərim” və “Əməkdaşlarımın işləri”." },
        { list: [
          "Kimi görürsünüz — firmanın strukturuna görə sizdən aşağıda olan hər kəsi: şöbə rəisi öz şöbəsini, direktor bütün firmanı.",
          "Firması seçilmiş iş həmin firmadakı rəhbərlərə görünür; firması olmayan iş — əməkdaşın istənilən firmadakı rəhbərinə.",
          "Cədvəldə “Əməkdaş” sütunu var; süzgəclər “Mənim işlərim”dəki kimidir.",
          "“Gecikənlər” tabı (sayğacla) son tarixi keçmiş, hələ tamamlanmamış işləri göstərir.",
          "“Aç” ilə işin addımlarına, fayllarına və tarixçəsinə baxırsınız. İşi dəyişmək, silmək, addıma ✓ qoymaq olmur.",
          "Pəncərənin altında “Rəhbərin qeydi” yazıb “Qeydi yaz” basın — qeyd işin tarixçəsinə düşür, əməkdaş onu görür. Qeyd silinmir.",
        ] },
        { note: "Əməkdaşa bildiriş getmir — qeydi o, işi açanda tarixçədə görür. Təcili məsələ üçün Çatdan istifadə edin." },
      ] },
    ],
  },
  {
    id: "requests", group: "Tapşırıqlar", title: "Sorğular", path: "Tapşırıqlar → Sorğular", section: "tasks.requests",
    intro: "Şöbələrarası iş tələbləri və məlumat sorğuları (məsələn, Təchizat → Mühasibatlıq). Tapşırıq yuxarıdan aşağı verilir, sorğu isə eyni firmanın başqa şöbəsinə gedir: o şöbənin rəhbəri qəbul edib icraçı seçir, icraçı cavablandırır, göndərən cavabı təsdiqləyir.",
    parts: [
      { audience: "all", title: "Statuslar", blocks: [
        { list: [
          "Yeni — göndərilib, şöbə rəhbəri hələ baxmayıb.",
          "Qəbul edildi — rəhbər icraçı və razılaşdırılmış tarix təyin edib; icraçıya tapşırıq düşüb.",
          "İcra olunur — icraçı işə başlayıb.",
          "Cavablandı — icraçı cavab verib; göndərənin təsdiqi gözlənilir.",
          "Qiymətləndirmə gözləyir — göndərən cavabı təsdiqləyib; şöbə rəhbəri icraçının işinə bal verməlidir.",
          "Bağlandı / İmtina edildi.",
        ] },
        { p: "Tablar: “Gələnlər” (şöbənizə gələnlər və sizə verilənlər), “Göndərdiklərim”, rəhbər üçün “Şöbəmin sorğuları” (şöbənizdən başqa şöbələrə gedənlər). Sizdən əməliyyat gözləyən sorğular sayğacla göstərilir." },
      ] },
      { audience: "all", title: "Sorğu göndərmək və cavabı qəbul etmək", blocks: [
        { steps: [
          "“Yeni sorğu”: firmanı, şöbəni, mövzunu, təsviri, istədiyiniz tarixi yazın, lazım olsa fayllar əlavə edin (ən çox 10), “Göndər”. Sorğu qəbul ediləndə bütün fayllar icraçının tapşırığına keçir; addımdan göndərilən sorğuya fayl seçilməsə, addımın bütün faylları gedir.",
          "Hələ “Yeni” ikən sorğunu silə (geri çağıra) bilərsiniz.",
          "Cavab gələndə (Cavablandı) ya “Cavabı təsdiqlə ✓”, ya da nəyin çatışmadığını yazıb “Yenidən aç” — iş icraçıya geri qayıdır.",
          "Sorğu bağlanana qədər hər iki tərəf şərh yaza bilər.",
        ] },
        { note: "İcraçıya verilən bal şöbənin daxili məsələsidir — sorğunu göndərən tərəf onu görmür." },
      ] },
      { audience: "all", title: "İcraçı üçün", blocks: [
        { p: "Qəbul edilmiş sorğu sizə tapşırıq kimi düşür (Verilən tapşırıqlar, “Sorğu əsasında”). “İcraya al”, sonra “Təqdim et” — cavab mətni və faylı sorğunu göndərənə gedir. Sorğu yenidən açılarsa, tapşırıq “Geri qaytarılıb” olur." },
      ] },
      { audience: "head", title: "Şöbə rəhbəri üçün", blocks: [
        { list: [
          "Gələn sorğunu “Qəbul et”: icraçını şöbənizin əməkdaşlarından seçin və razılaşdırılmış tarixi yazın. Və ya səbəbini yazaraq “İmtina et”.",
          "İcra gedərkən “İcraçını dəyiş” — köhnə icraçının tapşırığı götürülür, yenisinə yeni tapşırıq düşür.",
          "Göndərən cavabı təsdiqləyəndən sonra “Qiymətləndir”: 1–10 bal və istəyə görə rəy — sorğu bağlanır, icraçının tapşırığı təsdiqlənir.",
        ] },
      ] },
      { audience: "all", title: "Hüquqlar firma üzrədir", blocks: [
        { note: "Sorğular üzrə hüquqlarınız (Baxış, Əlavə et, Dəyişiklik et, Sil) hər firmada ayrıca verilir. Hansı firmada icazəniz yoxdursa, o firmanın sorğuları sizə görünmür, yeni sorğuda da o firmanın şöbələri çıxmır; şəxsi işin addımından sorğu göndərmək də yalnız işin firmasında “Əlavə et” olanda mümkündür." },
      ] },
      { audience: "admin", title: "Admin üçün", blocks: [
        { p: "Admin bütün sorğuları görür və istənilən mərhələdə rəhbərin əvəzinə hərəkət edə bilər. Rəhbəri təyin olunmamış şöbəyə gələn sorğular yalnız adminə düşür. Sorğular firmanın strukturundakı şöbələrə gedir — struktur boşdursa, sorğu göndərmək olmur." },
      ] },
    ],
  },
  {
    id: "fixed", group: "Tapşırıqlar", title: "Sabit işlər", path: "Tapşırıqlar → Sabit işlər", section: "tasks.fixed",
    intro: "Sabit işlər hər həftə, ay, rüb, yarımil və ya il təkrarlanan, konkret işçiyə həvalə edilmiş işlərdir (məsələn, aylıq hesabat, həftəlik yoxlama). Hər dövr üçün işçi işin icrasını cədvəldə qeyd edir — icra edilmiş xana rənglə (yaşıl və ya narıncı) göstərilir.",
    parts: [
      { audience: "all", title: "Dövrlər və son tarixlər", blocks: [
        { p: "Bölmənin yuxarısında tablar var: Həftəlik · Aylıq · Rüblük · Yarımillik · İllik. Hər tabın yanında iş sayı, gecikən varsa qırmızı nişan görünür. Sizdə hansı növ iş yoxdursa, o tab göstərilmir (admin bütün tabları görür)." },
        { list: [
          "Aylıq iş ay bitəndən sonra açılır və növbəti ayın göstərilən gününədək icra olunmalıdır. Standart son gün — 10-u. Məsələn: yanvarın işi 1 fevralda açılır, son tarix 10 fevral (günün sonuna qədər).",
          "Göstərilən gün ayda yoxdursa (məs. 31-i), son tarix ayın son gününə düşür.",
          "Həftəlik iş də həftə bitəndən sonra açılır və növbəti həftənin göstərilən gününədək icra olunmalıdır. Standart — cümə. Məsələn: 05.10 – 11.10 həftəsinin işi 12 oktyabrda (bazar ertəsi) açılır, son tarix 16 oktyabr (cümə).",
          "Həftə bazar ertəsinin düşdüyü aya aiddir: iki aya düşən həftə (məs. 26.10 – 01.11) yalnız bir ayın cədvəlində — bazar ertəsinin ayında — görünür və bir dəfə hesablanır.",
          "Rüblük iş rüb bitəndən sonra açılır və həmişə növbəti rübün 1-ci ayının 20-sinədək icra olunmalıdır — bu tarix dəyişmir. Məsələn: I rüb 1 apreldə açılır, son tarix 20 aprel; III rüb 2026 1 oktyabrda açılır, son tarix 20 oktyabr 2026.",
          "Yarımillik və illik iş də dövr bitəndən sonra açılır; son tarixi admin “dövr bitəndən sonra neçənci ayın neçəsi” kimi seçir. Standart: yarımillik — 1-ci ayın 20-si, illik — 3-cü ayın 31-i. Məsələn: II yarımil 1 yanvarda açılır, son tarix 20 yanvar; 2026-cı ilin işi 1 yanvar 2027-də açılır, son tarix 31 mart 2027.",
          "Cədvəldə rüblük işlərdə sütunlar I–IV rüb, yarımillikdə I–II yarımildir (ili seçin), illik işlərdə isə illərdir.",
          "Bütün vaxtlar Bakı vaxtı ilə hesablanır.",
        ] },
      ] },
      { audience: "all", title: "Hansı dövrlər hesablanır", blocks: [
        { list: [
          "Sabit işlər “Hesablama başlanğıcı” tarixindən (standart — 01.10.2026) hesablanır. Aylıq və həftəlik işdə dövr yalnız bu tarixdə və ya ondan sonra başlayırsa hesablanır: bundan əvvəlki aylar və bazar ertəsi bu tarixdən əvvəl olan həftələr boz zolaqlı xana ilə — “Hesablanmır” — görünür: gecikmə sayılmır və işarələnmir. Məsələn, Sentyabr və 28.09 – 04.10 həftəsi hesablanmır, ilk hesablanan həftə 05.10 – 11.10-dur.",
          "Rüblük, yarımillik və illik işdə dövr icra üçün açıldığı gün bu tarixdə və ya ondan sonradırsa hesablanır. Məsələn, III rüb 2026 (1 oktyabrda açılır, son tarix 20 oktyabr) və 2026-cı il (1 yanvar 2027-də açılır) hesablanır; II rüb 2026 (1 iyulda açılıb) hesablanmır.",
          "Dövr yalnız iş sizə həmin dövr açılmazdan əvvəl təyin edilibsə hesablanır. Aylıq iş 15 oktyabrda təyin edilibsə, Oktyabr hesablanır (1 noyabrda açılır); 2 noyabrda təyin edilibsə, ilk dövr Noyabrdır. Həftəlik iş də belədir: 14 oktyabrda (çərşənbə) təyin edilibsə, 12.10 – 18.10 həftəsi hesablanır (19 oktyabrda açılır); həftə açılandan sonra təyin edilibsə, növbəti həftədən hesablanır.",
          "Hesablanmayan dövrdə əvvəllər qoyulmuş qeyd yaşıl (icra edilib) göstərilir, gecikmə rəngi olmadan.",
        ] },
      ] },
      { audience: "all", title: "İşin icrasını necə qeyd etməli", blocks: [
        { steps: [
          "Tapşırıqlar → Sabit işlər bölməsini açın və yuxarıda lazımi tabı seçin (Həftəlik, Aylıq, Rüblük, Yarımillik, İllik).",
          "“Mənim sabit işlərim” cədvəlində ili seçin (həftəlik işlərdə — həm də ayı). Hər sətir bir işdir, sütunlar dövrlərdir.",
          "İcra etdiyiniz dövrün xanasına basın və “icra edildi kimi işarələnsin?” sualını təsdiqləyin.",
        ] },
        { p: "Hər işçinin öz rəngi var: siyahıda firma xanası və “Personal sabit işlər”dəki ad həmin rənglə göstərilir, rəng hər yerdə eynidir. Boz (“Seçin”) xana — iş həmin firmada heç kimə verilməyib." },
        { p: "Sütun başlıqlarındakı ▾ düyməsi ilə digər cədvəllərdəki kimi süzmək (iş, açıqlama, firma, istifadəçi, son tarix) və A→Z / Z→A sıralamaq olar." },
        { p: "Xananın rəngi dövrün vəziyyətini göstərir:" },
        { list: ["Hesablanmır (boz, çəp zolaqlı) — dövr hesablama başlanğıcından və ya işin təyinindən əvvəldir.", "Hələ açılmayıb (zolaqlı) — bu dövrü hələ işarələmək olmur.", "Açıqdır (mavi çərçivə) — icra etmək vaxtıdır.", "Vaxtında icra edilib (yaşıl).", "Gecikməklə icra edilib (narıncı) — son tarixdən sonra işarələnib.", "Gecikib (qırmızı, gün sayı ilə) — son tarix keçib, iş hələ icra edilməyib."] },
        { note: "Səhvən qoyulmuş qeydi geri götürmək: rəngli xanaya basın və “icra qeydi geri götürülsün?” sualını təsdiqləyin. Bunu işin son tarixinədək özünüz edə bilərsiniz; son tarix keçəndən sonra qeydi yalnız admin geri götürür. Hər geri götürmə Əməliyyat jurnalına yazılır. İcra tarixini görmək üçün siçanı xananın üzərinə gətirin." },
        { note: "Bir neçə firmada işləyirsinizsə, cədvəl soldakı “Aktiv firma” seçiminə görə göstərilir; eyni iş hər firma üzrə ayrıca sətirdir. “Bütün firmalar” seçiləndə bütün firmaların işləri “Firma” sütunu ilə birlikdə görünür." },
      ] },
      { audience: "all", title: "Tez-tez verilən suallar", blocks: [
        { qa: [
          ["Son tarix keçib, yenə icra edildi kimi işarələyə bilərəmmi?", "Bəli. Dövr açıqdırsa, istənilən vaxt işarələmək olar, amma iş “Gecikməklə icra edilib” kimi qalır."],
          ["Xanaya basa bilmirəm.", "Dövr hələ açılmayıb (cari ayın aylıq işi yalnız növbəti ayın 1-də, cari həftənin işi isə növbəti bazar ertəsi açılır), dövr hesablanmır (boz, çəp zolaqlı) və ya Giriş icazələrində bu bölmə sizin üçün bağlıdır. İcra edilmiş xananı isə son tarix keçəndən sonra yalnız admin dəyişə bilər."],
          ["Səhvən “icra edildi” qoydum.", "Son tarix keçməyibsə, xanaya yenidən basıb qeydi geri götürün. Keçibsə, adminə müraciət edin."],
          ["Mənə yeni iş lazımdır və ya iş başqasına keçməlidir.", "Sabit işləri yalnız admin yaradır və təyin edir — ona müraciət edin."],
        ] },
      ] },
      { audience: "head", title: "Əməkdaşlarımın sabit işləri", blocks: [
        { p: "Firmanın strukturunda tabeliyinizdə əməkdaş varsa, Sabit işlərin yuxarısında iki tab görünür: “Mənim sabit işlərim” və “Əməkdaşlarımın sabit işləri”." },
        { list: [
          "Görünənlər — strukturda sizdən aşağıda olan bütün əməkdaşlar (bütün səviyyələr, həmin firma üzrə). Direktor firmanın hamısını görür.",
          "Cədvəldə “İstifadəçi” sütunu var, hər əməkdaş öz rəngi ilə göstərilir; sütun başlıqlarında filtr və sıralama işləyir.",
          "Tabın yanındakı qırmızı nişan — əməkdaşların gecikən dövrlərinin sayı. Həftəlik · Aylıq · Rüblük · Yarımillik · İllik tablarında da gecikənlər ayrıca göstərilir.",
          "Bu cədvəl yalnız baxış üçündür: əməkdaşın işini icra edildi kimi işarələmək və ya qeydi geri götürmək olmur — bunu işçinin özü (və ya admin) edir.",
        ] },
      ] },
      { audience: "admin", title: "Sabit işin yaradılması və təyini", blocks: [
        { steps: [
          "“Sabit işlərin siyahısı” tabında işin adını və açıqlamasını yazıb “Siyahıya əlavə et” basın.",
          "Sətirdə son tarixi seçin: aylıq — növbəti ayın günü, həftəlik — növbəti həftənin günü, yarımillik / illik — dövrdən sonrakı ay (1-ci, 2-ci…) və gün. Seçilməsə, standart işləyir: 10-u / cümə / 1-ci ayın 20-si / 3-cü ayın 31-i. Rüblük işdə seçim yoxdur — son tarix həmişə növbəti rübün 1-ci ayının 20-sidir.",
          "İşin aid olduğu firmaları işarələyin və hər firma üçün icra edəcək istifadəçini seçin. Bir firmada bir iş yalnız bir nəfərə təyin olunur.",
          "“Personal sabit işlər” tabında işlərin personal və firmalar üzrə bölgüsünə baxın; buradan da bir işi seçib istifadəçiyə bir neçə firma üzrə birdən təyin etmək olar.",
        ] },
        { list: [
          "Redaktə: “Sabit işlərin siyahısı”nda işin sətrindəki “Redaktə et” — adı və açıqlamanı dəyişib “Yadda saxla” basın. İş artıq təyin edilibsə, yeni ad həmin işçilərin cədvəlində də dərhal görünür. Aylıq işi həftəlikə (və ya əksinə) çevirmək olmur — lazımsa, işi silib yenisini yaradın.",
          "Silmə: “Sil” yalnız iş heç bir işçiyə təyin edilməyəndə işləyir (təsdiq soruşulur). Təyin edilmiş işdə düymə bozdur — əvvəlcə işi işçilərdən götürün: firmanın xanasında “Seçin”i seçin və təsdiqləyin. Diqqət: işçinin həmin firma üzrə icra qeydləri də silinir; bu da jurnala yazılır. İşin firma işarələri onunla birlikdə silinir.",
          "Redaktə və silmə Əməliyyat jurnalına yazılır (“köhnə ad → yeni ad”).",
          "Hər iki cədvəldə sütun başlıqlarında filtr var; siyahıda firma sütunlarının filtri ilə, məsələn, həmin firmada heç kimə təyin edilməyən işləri (Boş) tapmaq olar.",
        ] },
        { list: [
          "“Hesablama başlanğıcı” — “Sabit işlərin siyahısı” tabının yuxarısında tarixi seçib “Yadda saxla” basın. Bu tarixdən əvvəlki dövrlər hamı üçün “Hesablanmır” olur. Dəyişiklik Əməliyyat jurnalına yazılır.",
          "Admin icra qeydini istənilən vaxt geri götürə bilər (son tarix keçəndən sonra da) — İstifadəçi görünüşündə rəngli xanaya basın.",
          "İşi istifadəçiyə yenidən təyin etsəniz (götürüb təzədən vermək), təyin tarixi yenilənir və ondan əvvəlki dövrlər həmin istifadəçi üçün hesablanmır.",
        ] },
        { note: "Yeni iş yuxarıda seçilmiş növün tabında yaranır — əvvəlcə tabı seçin. İstifadəçidə işin firmasında “Sabit işlər” icazəsi bağlıdırsa, o, həmin firmanın işlərini görmür və icra edildi kimi işarələyə bilməz — Giriş icazələrində bu barədə xəbərdarlıq çıxır." },
      ] },
    ],
  },
  {
    id: "incoming", group: "Sənədlər", title: "Daxil olan sənədlər", path: "Sənədlər → Daxil olan sənədlər", section: "documents.incoming", registrarKey: "documents.incoming",
    intro: "Firmaya kənardan gələn sənədlərin qeydiyyatı, rəhbərin baxışı və dərkənarı, şöbələrin icrası və iki səviyyəli təsdiq. Hər firmanın öz Daxil olma No ardıcıllığı var.",
    parts: [
      { audience: "all", title: "Sənədi kim görür (kommersiya sirri)", blocks: [
        { list: [
          "Admin və firmanın rəhbəri (direktor) — firmanın bütün sənədlərini.",
          "Qeydiyyatçı (Giriş icazələrində həmin firmada “Daxil olan sənədlər” icazəsi olan) — həmin firmanın sənədlərini; icazəsi yalnız bəzi sənəd növləri üçündürsə — yalnız o növlərin sənədlərini.",
          "Aidiyyatı şöbələrin rəhbərləri.",
          "Məlumatlandırılan şöbələrin rəhbərləri — yalnız baxış üçün.",
          "Sənəd üzrə tapşırıq alan şəxs və rəhbərin tapşırığı həvalə etdiyi əməkdaş.",
          "Sənəddən yaradılmış sorğunun icraçısı, onu yaradan və sorğunun getdiyi şöbənin rəhbəri.",
        ] },
        { note: "Şöbələrin sıravi əməkdaşları sənədləri görmür." },
      ] },
      { audience: "all", title: "Statuslar", blocks: [
        { list: [
          "Rəhbərin baxışında — sənəd qeydə alınıb, rəhbər hələ baxmayıb.",
          "Rəhbər tanış olub — rəhbər “Tanış oldum” basıb, tapşırıq verməyib.",
          "İcradadır — şöbə(lər) tapşırığı icra edir (bir neçə şöbədə: “İcradadır (1/2 şöbə)”).",
          "İcra olundu — bütün tapşırıqlar təsdiqlənib.",
          "Bağlandı — rəhbər son təsdiqi verib.",
        ] },
      ] },
      { audience: "registrar", title: "Sənədin qeydiyyatı", blocks: [
        { steps: [
          "“Yeni sənəd” basın. Bir neçə firmada qeydiyyat aparırsınızsa, firmanı seçin.",
          "Göndərənin VÖEN-ini yazın: təşkilat müştəri siyahısındadırsa, adı və telefonu kartdan avtomatik gəlir. Siyahıda yoxdursa, elə oradaca müştəri kartını yaradın. Dövlət qurumu üçün VÖEN boş qala bilər — onda adı əl ilə yazılır.",
          "Göndərənin sənəd nömrəsini və tarixini, sənədin tipini, daxil olma yolunu, qısa məzmunu, vərəq və nüsxə sayını yazın.",
          "Aidiyyatı şöbə(lər)i seçin. Sənədin tipinin şablonunda şöbələr göstərilibsə, onlar avtomatik yazılır və dəyişdirilmir.",
          "İstəsəniz, “Məlumatlandırılan şöbə(lər)” seçin — onların rəhbərləri sənədi yalnız görür.",
          "Skanı elə burada və ya sonra cədvəldən yükləyin, “Qeydə al” basın.",
        ] },
        { list: [
          "Daxil olma No avtomatik verilir (firma üzrə ardıcıl); onu yalnız admin dəyişə bilər.",
          "Skan şablondakı qaydaya görə adlandırılıb şablonda seçilmiş papkaya yazılır; şablon yoxdursa və ya papka seçilməyibsə, sistemdə saxlanılır.",
          "Şablondakı papka serverdə tapılmasa (silinib və ya adı dəyişib), skan yüklənmir — adminə müraciət edin.",
          "Şöbələrdən biri təsdiq verəndən sonra sənədi dəyişmək və silmək yalnız adminə qalır. Tapşırıq və ya sorğusu olan sənədi də yalnız admin silir.",
          "Hüquqlarınız Giriş icazələrindən gəlir və hər firmada ayrıdır: Baxış, Əlavə et (qeydiyyat və skanı olmayana skan yükləmək), Dəyişiklik et, Sil. Yeni sənəddə firma siyahısında yalnız qeydiyyat icazəniz olan firmalar görünür.",
          "İcazəniz bir firmada yalnız bəzi sənəd növləri üçündürsə (məs. yalnız “Forma 2”), “Sənədin tipi” siyahısında yalnız o növlər olur, başqa növü qeydə almaq olmur; sənədi dəyişmək və silmək də yalnız özünüzün qeydə aldığı sənədlərdə mümkündür.",
        ] },
      ] },
      { audience: "director", title: "Rəhbərin baxışı və dərkənar", blocks: [
        { steps: [
          "“Rəhbərin baxışında” tabında sizə düşən sənədlər görünür (menyuda sayğac da olur).",
          "Tapşırıq lazım deyilsə, “Tanış oldum” basın (qeyd istəyə bağlıdır).",
          "Tapşırıq lazımdırsa, “Tapşırıq ver”: şöbə(lər)i və/və ya birbaşa işçi(lər)i seçin, icra müddətini və dərkənarı (göstərişi) yazın. Şöbəyə verilən tapşırıq şöbənin rəisinə gedir — rəisi təyin edilməyən şöbə seçilə bilməz.",
          "Heç kim icraya başlamayıbsa, “Tapşırıqları dəyiş” ilə alıcıları dəyişmək olar.",
          "Alıcılar tapşırığı təqdim edəndə onu siz təsdiqləyirsiniz: Verilən tapşırıqlar → “Təsdiqimi gözləyir” (bal və rəy, və ya səbəbini yazıb geri qaytarmaq).",
        ] },
      ] },
      { audience: "head", title: "Şöbədə icra", blocks: [
        { list: [
          "Rəhbərin tapşırığı sizin Tapşırıqlar siyahınıza düşür; işi şöbə daxilində əməkdaşa həvalə edə bilərsiniz — o da sənədi görür.",
          "Başqa şöbədən nəsə lazımdırsa, sənədin sətrindən “Sorğu yarat”: şöbəni, nə lazım olduğunu və arzu olunan müddəti yazın. Sorğu sənədə bağlanır, qarşı şöbə skanı sorğudan aça bilir.",
        ] },
      ] },
      { audience: "head", title: "Təsdiq (iki səviyyə)", blocks: [
        { steps: [
          "Rəhbər sənədə baxandan (və ya tapşırıq verəndən) sonra aidiyyatı və tapşırıq alan şöbələrin rəhbərləri “Təsdiq et” verir. Şöbədə bu sənəd üzrə tapşırıq hələ bağlanmayıbsa, təsdiq vermək olmur.",
          "Bütün şöbələr təsdiqləyəndən sonra (və ya gözləmədən) firmanın rəhbəri “Son təsdiq” verir — sənəd “Bağlandı” olur.",
          "Rəhbər səbəbini yazaraq “Geri qaytar” edə bilər — şöbələr yenidən təsdiqləməli olur.",
        ] },
        { note: "Məlumatlandırılan şöbələr təsdiq vermir. “Təsdiqimi gözləyir” tabında sizdən təsdiq gözləyən sənədlər görünür." },
      ] },
    ],
  },
  {
    id: "outgoing", group: "Sənədlər", title: "Çıxan sənədlər", path: "Sənədlər → Çıxan sənədlər", section: "documents.outgoing", registrarKey: "documents.outgoing",
    intro: "Firmanın göndərdiyi sənədlərin (müqavilə, akt, məktub və s.) qeydiyyatı, yazılmış və imzalı nüsxələrin papkada saxlanması, imzalı nüsxənin qaytarılma müddətinin izlənməsi və iki səviyyəli təsdiq.",
    parts: [
      { audience: "all", title: "Sənədi kim görür (kommersiya sirri)", blocks: [
        { list: [
          "Admin və firmanın rəhbəri (direktor) — firmanın bütün sənədlərini.",
          "Qeydiyyatçı (həmin firmada “Çıxan sənədlər” icazəsi olan) — həmin firmanın sənədlərini; icazəsi yalnız bəzi sənəd növləri üçündürsə (məs. mühasib — “Forma 2”) — yalnız o növlərin sənədlərini.",
          "Əlaqəli (aidiyyatı) şöbələrin rəhbərləri.",
          "Məlumatlandırılan şöbələrin rəhbərləri — yalnız baxış üçün.",
          "Sənədi götürən məsul şəxs — öz sənədlərini.",
        ] },
        { note: "Şöbələrin sıravi əməkdaşları sənədləri görmür." },
      ] },
      { audience: "all", title: "Nömrələr və qaytarılma müddəti", blocks: [
        { list: [
          "Çıxış No — firma üzrə vahid, kəsilməz ardıcıllıqdır (tipdən asılı deyil).",
          "Sənədin Nömrəsi — firma və sənəd tipi üzrə ayrıca, hər il 1-dən başlayır: 001/2026.",
          "İmzalı nüsxəsi geri qaytarılan sənədin (şablonda “Bəli”) qaytarılma tarixi çıxış tarixi + şablondakı gün sayıdır; qeydiyyatçı onu dəyişə bilər.",
          "Cədvəldə: “N gün qalıb”, “Yubanır — N gün”, “✓ Qaytarılıb”. “Yubananlar” tabında gecikənlər şöbə və məsul üzrə süzülür; Sənədlər icmalında “Yubanan sənədlər” kartı var.",
          "İmzalı nüsxə yüklənəndə ona Daxil olma No və tarixi avtomatik verilir (Çıxan sənədlərin öz ardıcıllığı).",
          "Qaytarılma tarixi keçib, imzalı nüsxə hələ yüklənməyibsə, yuxarıdakı 🔔 Bildirişlərdə “Qayıtmayan imzalı nüsxələr” bölməsində görünür — qeydiyyatçılara və əlaqəli şöbələrin rəhbərlərinə. Sənədə basanda “Yubananlar” tabı açılır; zəngdəki say bildirişlərə baxanda sıfırlanır, sənəd isə imzalı nüsxə yüklənənədək siyahıda qalır.",
          "Müştəri üzrə bütün sənədlərə Müştərilər bölməsində, “Sənəd dövriyyəsi” sütunundan baxmaq olar.",
        ] },
      ] },
      { audience: "all", title: "Məsul şəxs", blocks: [
        { p: "“Sənədi götürən şəxs (məsul)” sənədi aparan və imzalı nüsxənin vaxtında qayıtmasına cavabdeh olan əməkdaşdır. O, sənədin əlaqəli şöbələrinin əməkdaşlarından seçilir və bu sənədi öz siyahısında görür." },
      ] },
      { audience: "registrar", title: "Sənədin qeydiyyatı", blocks: [
        { steps: [
          "“Yeni sənəd” basın (soldakı “Aktiv firma”da “Bütün firmalar” seçilibsə, formada firmanı seçin).",
          "Sənədin tipini seçin — siyahıda yalnız həmin firmanın “Çıxan sənəd” şablonları olur. Şablonun faylları “Şablondan istifadə et” panelində yüklənir.",
          "Əlaqəli şöbə(lər): şablonda göstərilibsə, avtomatik yazılır və dəyişdirilmir; yoxdursa, özünüz seçin (birinci seçilən — əsas şöbə, fayl adındakı {Şöbə}).",
          "İstəsəniz, “Məlumatlandırılan şöbə(lər)” seçin.",
          "VÖEN-i yazın — təşkilatın adı və telefonu müştəri kartından gəlir (VÖEN müştəri siyahısında olmalıdır).",
          "Göndərilmə şəklini, nüsxə sayını, sənədin tarixini, məsul şəxsi seçin. “İmzalı nüsxə geri qaytarılır” şablondan gəlir, bu sənəd üçün dəyişmək olar.",
          "İstəsəniz, yazılmış sənədi (Word) elə burada yükləyin və “Əlavə et” basın.",
        ] },
        { list: [
          "İlkin sənəd (Word) və Hazır sənəd (imzalı və ya sürəti) şablondakı ad qaydası ilə adlandırılıb şablonda seçilmiş papkalara yazılır; papka seçilməyibsə, sistemdə saxlanılır. İkisi eyni adı daşıyır.",
          "Şablondakı papka serverdə tapılmasa (silinib və ya adı dəyişib), fayl yüklənmir — adminə müraciət edin.",
          "Fayl papkada əl ilə köçürülüb və ya silinibsə, cədvəldə “Fayl papkada tapılmadı” görünür.",
          "Şöbələrdən biri təsdiq verəndən sonra sənədi dəyişmək və silmək yalnız adminə qalır; hazır (imzalı) sənədi yüklənmiş sənədi də yalnız admin silir.",
        ] },
      ] },
      { audience: "head", title: "Təsdiq (iki səviyyə)", blocks: [
        { steps: [
          "Hazır sənəd (imzalı nüsxə və ya qaytarılmayan sənədin sürəti) yüklənəndən sonra əlaqəli şöbələrin rəhbərləri “Təsdiq et” verir.",
          "Sonra firmanın rəhbəri “Son təsdiq” verir; səbəb yazaraq “Geri qaytar” da edə bilər — şöbələr yenidən təsdiqləyir.",
        ] },
        { note: "Məlumatlandırılan şöbələr təsdiq vermir. “Təsdiqimi gözləyir” tabında sizdən gözlənilənlər görünür." },
      ] },
    ],
  },
  {
    id: "customers", group: "Sənədlər", title: "Müştərilər", path: "Sənədlər → Müştərilər", section: "dashboard.customers",
    intro: "Sənəd göndərdiyimiz və sənəd aldığımız təşkilatların kartları. Çıxan və daxil olan sənədlər müştəriyə VÖEN üzrə bağlanır, ona görə hər müştərinin sənəd tarixçəsi bir yerdə görünür.",
    parts: [
      { audience: "all", title: "Müştəri üzrə sənədlərin tarixçəsi", blocks: [
        { steps: [
          "Cədvəlin “Sənəd dövriyyəsi” sütununda hər müştəri üçün çıxan (➡) və daxil olan (⬅) sənədlərin sayı görünür; sənədi olmayan müştəridə “—” yazılır.",
          "Saylara basın — sətrin altında tarixçə açılır (yenidən basanda bağlanır).",
          "Siyahıda həmin VÖEN üzrə çıxan (➡) və daxil olan (⬅) sənədlər tarix sırası ilə, ən yenisi yuxarıda göstərilir: tarix, nömrə, firma, növ, sənədin nömrəsi, qısa məzmun, vəziyyət və fayl.",
          "Yuxarıdakı tablar: Hamısı, Çıxan, Daxil olan, Qayıtmayanlar. Növ (bir neçə növ olanda) və tarix aralığı ilə də süzmək olar.",
          "“Fayl” sütununda: çıxan sənəd üçün “Hazır” (imzalı nüsxə və ya sürəti) və ya “İlkin” (Word), daxil olan sənəd üçün “Aç”.",
        ] },
        { list: [
          "Çıxan sənədin vəziyyəti: “Gözlənilir — N gün qalıb”, “Yubanır — N gün”, “✓ Qayıdıb — tarix” (imzalı nüsxə yüklənəndə), “Qaytarılmır” (imzalı nüsxəsi geri gəlməyən sənəd).",
          "Daxil olan sənədin vəziyyəti Daxil olan sənədlər bölməsindəki statusdur.",
          "Qayıtmayan imzalı nüsxəsi olan müştərinin sütununda qırmızı “N qayıtmayıb” yazılır.",
          "Sütunun başlığındakı süzgəclə yalnız “Qayıtmayan var” və ya “Sənəd var” olan müştəriləri saxlamaq, saya görə sıralamaq olar.",
        ] },
        { note: "Tarixçədə yalnız Çıxan və Daxil olan sənədlər bölmələrində görməyə icazəniz olan sənədlər görünür (kommersiya sirri). Ona görə eyni müştəri üzrə fərqli işçilər fərqli sayda sənəd görə bilər. VÖEN-i olmayan sənədlər tarixçəyə düşmür." },
      ] },
    ],
  },
  {
    id: "templates", group: "Sənədlər", title: "Şablonlar", path: "Sənədlər → Şablonlar", section: "documents.templates",
    intro: "Sənəd tipləri və onların qaydaları. Hər şablon bir firmaya və bir qrupa aiddir: Çıxan sənəd, Daxil olan sənəd, Kadrlar (Digər əmrlər).",
    parts: [
      { audience: "admin", title: "Şablonun yaradılması", blocks: [
        { steps: [
          "Yuxarıda firmanı və qrup tabını seçin, “Yeni sənəd” basın.",
          "Adı yazın — eyni firmanın eyni qrupunda ad təkrarlanmır (başqa firmada və ya qrupda eyni ad ola bilər).",
          "Çıxan sənəd: aidiyyatı şöbələr, “İmzalı nüsxə geri qaytarılır” və qaytarılma müddəti, şablon faylları (3 versiya), ilkin və hazır sənəd papkaları, ad qaydası.",
          "Daxil olan sənəd: aidiyyatı şöbələr, skanın papkası və ad qaydası.",
          "Kadrlar: Word (.docx) faylı — əmrin mətni ondan oxunur; yer tutucular formada göstərilir.",
        ] },
        { list: [
          "Aidiyyatı şöbələr firmanın strukturundan seçilir; birinci — əsas şöbə. Göstərilibsə, bu tipli sənəd qeydə alınanda şöbələr avtomatik yazılır və qeydiyyatçı dəyişə bilmir.",
          "Ad qaydasının dəyişənləri: {ÇıxışNo}, {DaxilOlmaNo}, {SənədNo}, {SənədTipi}, {Təşkilat}, {VÖEN}, {Firma}, {Şöbə}, {Tarix}, {İl}, {Ay}.",
          "“Kopyala” şablonu faylları, papkaları və qaydaları ilə başqa firmaya və ya qrupa köçürür. Hədəf firmada olmayan şöbələr köçmür — bu barədə xəbər verilir.",
          "“✕ Faylı sil” yanlış seçilmiş faylı “Yadda saxla” ilə silir (fayl başqa şablonda istifadə olunmursa, yaddaşdan da).",
        ] },
      ] },
      { audience: "admin", title: "Papkaların seçilməsi", blocks: [
        { steps: [
          "Əvvəlcə papkanı serverdə özünüz yaradın (məs. Arsenal → Sənədlər → Müqavilə) — proqram papka yaratmır.",
          "Şablonun papka sahəsində “Papka seç” basın: serverin diskləri açılır.",
          "Diskə, sonra içindəki papkalara basaraq lazım olan papkaya keçin; “⬆ Yuxarı” bir pillə geri, “Disklər” əvvələ qaytarır.",
          "Lazım olan papkada “Bu papkanı seç”, sonra şablonda “Yadda saxla” basın.",
        ] },
        { list: [
          "Hər papka ayrıca seçilir: Çıxan sənəd üçün ilkin sənəd papkası (Word), hazır sənəd papkası (imzalı nüsxə), Daxil olan sənəd üçün papka (skan).",
          "Şəbəkə papkasını (\\\\server\\paylaşım) pəncərənin yuxarısındakı sahəyə yazıb “Aç” basın, sonra oradan davam edin.",
          "Papka yolunda dəyişən ({İl}, {Firma} və s.) olmur — dəyişənlər yalnız ad qaydasındadır.",
          "“✕” seçilmiş papkanı götürür; papka seçilməyibsə, sənəd sistemdə saxlanılır.",
          "Seçilmiş papka sonradan serverdən silinsə və ya adı dəyişsə, cədvəldə ⚠ görünür və bu tipli sənədin faylı yüklənmir — papkanı yenidən seçin.",
          "Papka seçmək yalnız proqram öz serverdə işləyəndə mümkündür.",
        ] },
      ] },
    ],
  },
  {
    id: "chat", group: "Çat", title: "Çat", path: "Yuxarıdakı 💬 düyməsi", section: "chat",
    intro: "Proqramın istifadəçiləri arasında daxili yazışma: ümumi işçi qrupu və şəxsi söhbətlər, fayl göndərmək, yeni mesaj bildirişləri.",
    parts: [
      { audience: "all", title: "Çatı açmaq və pəncərə", blocks: [
        { list: [
          "Çat yuxarıdakı 💬 düyməsi ilə açılır; düymədə oxunmamış mesajların sayı görünür.",
          "Başlıqdakı “—” çatı yığır: küncdə kiçik “Çat” zolağı qalır və əvvəlki bölməyə qayıdırsınız. “⤢” bütün ekran, “✕” bağlayır.",
          "Panelin ölçüsünü, sol siyahının enini dəyişmək və paneli sürüşdürmək olar — seçim yadda qalır.",
        ] },
      ] },
      { audience: "all", title: "Söhbətlər siyahısı", blocks: [
        { list: [
          "Yuxarıda Axtarış — ada görə süzür.",
          "Ən yuxarıda həmişə “Ümumi işçi qrupu” (bütün aktiv istifadəçilər) durur.",
          "Sonra yazışdığınız adamlar — son mesajın vaxtına görə, ən sonuncu birinci. Yeni mesaj gələndə və ya siz yazanda həmin adam yuxarı qalxır.",
          "Sonda hələ yazışmadığınız istifadəçilər (əlifba ilə, “Yazışma yoxdur”) — adına basanda söhbət elə orada açılır.",
          "Adın altında son mesajın əvvəli, sağda vaxt və oxunmamış mesajların sayı görünür.",
        ] },
      ] },
      { audience: "all", title: "Mesaj yazmaq", blocks: [
        { list: [
          "Enter — göndərir, Shift+Enter — yeni sətir.",
          "📎 ilə fayl əlavə olunur (ən çox 25 MB).",
          "Şəxsi söhbətdə öz mesajınızın yanında ✓ — göndərilib, ✓✓ — qarşı tərəf oxuyub.",
          "Söhbət yalnız ekranda açıq olanda oxunmuş sayılır.",
        ] },
      ] },
      { audience: "all", title: "Bildirişlər", blocks: [
        { list: [
          "Yeni mesaj gələndə sağ aşağıda kart çıxır (göndərən, mesajın əvvəli; bir neçə mesajda say); karta basanda həmin söhbət açılır, 6 saniyədən sonra kart yox olur.",
          "Qısa səs çalınır — onu “Söhbətlər” başlığındakı səs düyməsi ilə söndürüb-yandırmaq olar (yadda qalır).",
          "Sayt önündə deyilsə, brauzerin (Windows-un) bildirişi çıxır; icazəni brauzer 💬-ə ilk basanda soruşur.",
          "Ekranda açıq olan söhbət və öz mesajınız üçün bildiriş çıxmır.",
        ] },
        { note: "Çat Giriş icazələrində bağlana bilər — istifadəçinin heç bir firmasında açıq deyilsə, 💬 düyməsi görünmür." },
      ] },
    ],
  },
  {
    id: "account", group: "Tənzimləmələr", title: "Şifrə, fon və profil şəkli", path: "Tənzimləmələr", section: "settings",
    intro: "Hər istifadəçinin öz hesabı üçün tənzimləmələr.",
    parts: [
      { audience: "all", title: "Nə etmək olar", blocks: [
        { list: [
          "Şifrəni dəyiş — cari şifrəni və yeni şifrəni (ən az 8 simvol) yazın.",
          "Fon şəkli — proqramın fonunda yalnız sizin görəcəyiniz şəkil (ən çox 8 MB).",
          "Profil şəkli — adınızın yanında görünən şəkil: Ana səhifədə, siyahılarda və çatda (ən çox 5 MB).",
        ] },
        { note: "Şifrəni unutmusunuzsa, admin İstifadəçilər bölməsində “Şifrəni yenilə” ilə yeni şifrə təyin edir." },
      ] },
      { audience: "all", title: "Aktiv firma və “Bütün firmalar”", blocks: [
        { list: [
          "Bir neçə firmada işləyirsinizsə, sol menyuda “Aktiv firma” seçimi var: tapşırıqlar, işlər, sorğular və sənədlər seçilmiş firmaya görə göstərilir. Seçim yadda qalır.",
          "Siyahının ən başındakı “Bütün firmalar” bütün firmalarınızın məlumatını bir yerdə göstərir; cədvəllərdə hər sətrin hansı firmaya aid olduğu “Firma” sütunundan görünür.",
          "“Bütün firmalar”da yeni nəsə yaradanda (sorğu, sənəd, iş) formada firmanı özünüz seçirsiniz — proqram firmanı özbaşına götürmür.",
          "Hüquqlar qarışmır: hər sənəd və iş üzrə nə edə biləcəyiniz həmin sətrin firmasındakı vəzifənizə görə müəyyən olunur. Məsələn, bir firmada şöbə rəisi, digərində əməkdaşsınızsa, təsdiqi yalnız birincinin sənədlərinə verə bilərsiniz.",
        ] },
        { note: "Tək firmada işləyənlər üçün bu seçim görünmür." },
      ] },
    ],
  },
  {
    id: "companies", group: "Tənzimləmələr", title: "Firmalar və struktur", path: "Tənzimləmələr → Firmalar", section: "settings",
    intro: "Firmaların reyestri və hər firmanın təşkilati strukturu (şöbələr, vəzifələr, tabeçilik). Struktur proqramın çox yerində işləyir: kimin rəhbər olduğu, kimə həvalə etmək olar, sorğuların və sənədlərin şöbələri, sənədləri kim görür.",
    parts: [
      { audience: "admin", title: "Firma", blocks: [
        { list: [
          "“Yeni firma”: adı, VÖEN-i, rəhbəri. “Məlumatları redaktə et” ilə dəyişilir.",
          "Firmanı deaktiv etmək olar — aktiv olmayan firma seçim siyahılarında görünmür və ona yeni şablon köçürülmür.",
        ] },
      ] },
      { audience: "admin", title: "Struktur", blocks: [
        { steps: [
          "Firmanın “Struktur” düyməsini basın.",
          "Hər vəzifə üçün şöbəni, vəzifənin adını və “Tabe olduğu” vəzifəni yazın. Ən yuxarıdakı vəzifə üçün “Ən yuxarı (heç kimə)” seçin. Eyni vəzifə iki dəfə əlavə olunmur.",
          "İstifadəçilər bölməsində işçini hər firma üzrə öz vəzifəsinə təyin edin.",
        ] },
        { list: [
          "Firmanın rəhbəri (direktor) — heç kimə tabe olmayan vəzifənin sahibidir (məs. Baş direktor).",
          "Şöbənin rəhbəri — şöbənin ən yuxarı vəzifəsinin (tabe olduğu vəzifə şöbədən kənarda olan) sahibidir.",
          "Vəzifə boşdursa, onun bilavasitə tabeliyindəkilər rəhbər kimi çıxış edir; həvalə zamanı boş vəzifə atlanır.",
          "Strukturda olmayan şöbəyə sorğu göndərmək, sənəd bağlamaq olmur — əvvəlcə strukturu doldurun.",
        ] },
      ] },
    ],
  },
  {
    id: "users", group: "Tənzimləmələr", title: "İstifadəçilər və Giriş icazələri", path: "Tənzimləmələr → İstifadəçilər", section: "settings",
    intro: "Proqramın istifadəçiləri, onların firmaları və vəzifələri, giriş hesabları və hər bölmə üzrə icazələri.",
    parts: [
      { audience: "admin", title: "İstifadəçi", blocks: [
        { list: [
          "“Yeni personal”: ad və soyad, e-poçt (həm də giriş adıdır), işlədiyi firmalar və hər firmada vəzifəsi (firmanın strukturundan), əsas iş yeri, şəkil.",
          "“Şifrəni yenilə” — istifadəçiyə yeni şifrə təyin edir.",
          "Deaktiv edilən istifadəçi proqrama girə bilmir və seçim siyahılarında görünmür.",
          "“İstifadəçi görünüşü” — proqramı həmin istifadəçinin gözü ilə görürsünüz (menyu, icazələr, tapşırıqlar); “Admin görünüşünə qayıt” ilə çıxırsınız.",
          "Tapşırığı olan istifadəçi silinmir — onu deaktiv edin.",
        ] },
      ] },
      { audience: "admin", title: "Giriş icazələri", blocks: [
        { list: [
          "İşarəsi götürülən bölmə istifadəçinin menyusunda görünmür və serverdə də bağlanır.",
          "Bəzi bölmələrdə dörd ayrıca hüquq var: Baxış, Əlavə et, Dəyişiklik et, Sil (Sorğular, Daxil olan və Çıxan sənədlər, Müştərilər, Nöqsanlar, Personallar, Əmrlər). Əlavə et / Dəyişiklik et / Sil Baxışı da açır; Baxışı götürmək hamısını götürür.",
          "İstifadəçinin firmaları alt-alta sıralanır və bütün icazələr hər firma üçün ayrıca verilir: firmanın adına basın — içində Tapşırıqlar (Sorğular, Şəxsi işlərim, Sabit işlər), Sənədlər (Daxil olan, Çıxan, Müştərilər), Kadrlar (Personallar, Əmrlər, Nöqsanlar) və Çat var. Məsələn, bir firmada yalnız Kadrları açıb qalanını bağlı saxlaya bilərsiniz. Firmanın yanındakı rəqəm orada neçə bölmənin açıq olduğunu göstərir; firmanın işarəsi həmin firmanı bütövlükdə açır / bağlayır.",
          "Şəxsi işlərim və Sabit işlər firma üzrədir: istifadəçi yalnız açıq olan firmaların işlərini görür və işarələyir (firması seçilməmiş şəxsi iş həmişə görünür). Müştərilər və Çat firmaya bağlı deyil — ən azı bir firmada açıq olanda görünür.",
          "İstifadəçiyə yeni firma əlavə edəndə o firmada hər şey bağlı olur — lazım olanları həmin firmanın içində açın. Firma istifadəçidən götürüləndə onun icazələri də silinir.",
          "“Başqa firmadan köçür...” (firmanın içində) — istifadəçinin seçilmiş digər firmasındakı icazələrini bu firmaya köçürür; bu firmadakı indiki icazələr əvəz olunur (seçilmiş sənəd növləri köçmür: “Bütün növlər” olur). Siyahıda hər firmanın yanında orada neçə bölmənin açıq olduğu yazılır.",
          "“Bu firmanın icazələrini bütün firmalara köçür” (firmanın içində) — həmin firmanın icazələrini istifadəçinin digər firmalarına köçürür (seçilmiş sənəd növləri köçmür: digər firmalarda “Bütün növlər” olur).",
          "Daxil olan və Çıxan sənədlərdə Baxış açıq olanda “Sənəd növləri” seçimi çıxır: “Bütün növlər” və ya “Seçilmiş növlər” — həmin firmanın şablonlarından işarələnir. Məsələn, mühasibə yalnız “Forma 2” növünü versəniz, o, Forma 2-ni özü qeydə alıb faylını yükləyir, yalnız Forma 2 sənədlərini görür və yalnız özünün qeydə aldıqlarını dəyişə / silə bilir.",
          "🔒 olan bəndlər (Verilən tapşırıqlar) həmişə açıqdır.",
          "Standart olaraq bağlıdır: Personallar və Əmrlər (şəxsi məlumatlar, maaş); Müştərilərdə Dəyişiklik et və Sil; Nöqsanlarda Əlavə et, Dəyişiklik et və Sil.",
          "“Başqa işçidən köçür...” — başqa istifadəçinin icazələrini köçürür (firma icazələri — yalnız hər ikisinin ortaq firmaları üçün); “Hamısını aç” — bütün firmalarda hamısını açır.",
          "Daxil olan və Çıxan sənədlər icazəsi “Bütün növlər” ilə verilən istifadəçi həmin firmada qeydiyyatçı sayılır və firmanın BÜTÜN sənədlərini görür — bunu yalnız qeydiyyatı aparan (Ümumi şöbə) əməkdaşlara verin; başqalarına “Seçilmiş növlər” verin.",
          "Sabit işi olan istifadəçidə həmin firmada “Sabit işlər”i bağlayanda xəbərdarlıq çıxır — o, o firmadakı işlərini icra edildi kimi işarələyə bilməyəcək. Bütün növlər (həftəlik … illik) üçün bir icazədir; əvvəlki “Aylıq” və “Həftəlik” icazələrindən biri açıq olan istifadəçidə o açıqdır.",
          "Şablonlar, Firmalar, İstifadəçilər və Əməliyyat jurnalı yalnız adminindir.",
        ] },
      ] },
    ],
  },
  {
    id: "audit", group: "Tənzimləmələr", title: "Əməliyyat jurnalı", path: "Tənzimləmələr → Əməliyyat jurnalı", section: "settings",
    intro: "Proqramda edilən əsas əməliyyatların (yaratma, dəyişmə, silmə, təsdiqlər) kim tərəfindən və nə vaxt edildiyinin xronoloji siyahısı.",
    parts: [
      { audience: "admin", title: "İstifadə", blocks: [
        { p: "Jurnal yalnız oxumaq üçündür: ən yeni əməliyyat yuxarıdadır. Kimin nəyi nə vaxt dəyişdiyini və ya sildiyini yoxlamaq üçün istifadə edin." },
      ] },
    ],
  },
];

const blockText = (b: Block) => ("p" in b ? b.p : "note" in b ? b.note : "steps" in b ? b.steps.join(" ") : "list" in b ? b.list.join(" ") : b.qa.flat().join(" "));

export function GuidesPage({ ctx }: { ctx: GuideContext }) {
  // Whether the viewer heads a department or directs a firm comes from the server (the firm structure).
  const [roles, setRoles] = useState({ head: false, director: false });
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/guides${ctx.viewEmployeeId ? `?employeeId=${ctx.viewEmployeeId}` : ""}`).then((r) => (r.ok ? r.json() : null)).then((body) => {
      if (!cancelled && body) setRoles({ head: Boolean(body.head), director: Boolean(body.director) });
    });
    return () => { cancelled = true; };
  }, [ctx.viewEmployeeId]);
  const sees = (audience: Audience, guide: Guide) => ctx.isAdmin || audience === "all"
    || (audience === "registrar" && Boolean(guide.registrarKey && ctx.rights[guide.registrarKey]))
    || (audience === "head" && (roles.head || roles.director)) || (audience === "director" && roles.director);
  const available = GUIDES.filter((g) => ctx.isAdmin || ctx.sections[g.section])
    .map((g) => ({ ...g, parts: g.parts.filter((p) => sees(p.audience, g)) })).filter((g) => g.parts.length);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>(() => { try { return window.localStorage.getItem("guides:selected") || ""; } catch { return ""; } });
  const q = query.trim().toLocaleLowerCase("az");
  const matches = (g: Guide) => !q || [g.title, g.intro, ...g.parts.flatMap((p) => [p.title, ...p.blocks.map(blockText)])].join(" ").toLocaleLowerCase("az").includes(q);
  const shown = available.filter(matches);
  const current = shown.find((g) => g.id === selected) || shown[0];
  const pick = (id: string) => { setSelected(id); try { window.localStorage.setItem("guides:selected", id); } catch { /* not stored */ } };
  const groups = [...new Set(shown.map((g) => g.group))];
  return <section className="panel pagepanel guidespage">
    <div className="pageactions directoryhead"><div><span className="sectioneyebrow">DAXİLİ İDARƏETMƏ</span><h2>Təlimatlar</h2><p>Bölmələrin işləmə qaydaları — sizə aid olan hissələr göstərilir</p></div>
      {current && <button type="button" className="guideprint" onClick={() => window.print()}><Printer />Çap et / PDF</button>}</div>
    {!available.length ? <p className="guideempty">Sizə açıq olan bölmələr üçün hələ təlimat yazılmayıb.</p> : <div className="guideslayout">
      <aside className="guidesnav">
        <label className="guidesearch"><Search /><Input value={query} placeholder="Təlimatlarda axtar..." onChange={(e) => setQuery(e.target.value)} /></label>
        {!shown.length && <small className="guideempty">Axtarışa uyğun təlimat tapılmadı.</small>}
        {groups.map((group) => <Fragment key={group}><b className="guidegroup">{group}</b>
          {shown.filter((g) => g.group === group).map((g) => <button type="button" key={g.id} className={current?.id === g.id ? "on" : ""} onClick={() => pick(g.id)}>{g.title}</button>)}</Fragment>)}
        <small className="guidesoon">Kadrlar bölməsinin təlimatı sonra əlavə olunacaq.</small>
      </aside>
      {current && <article className="guidearticle">
        <h3>{current.title}</h3>
        <p className="guidepath">Menyu: {current.path}</p>
        <p className="guideintro">{current.intro}</p>
        {current.parts.map((part, n) => <div className={`guidepart ${part.audience}`} key={n}>
          <h4>{part.title}{part.audience !== "all" && <em>{AUDIENCE_LABELS[part.audience]}</em>}</h4>
          {part.blocks.map((b, i) => "p" in b ? <p key={i}>{b.p}</p>
            : "note" in b ? <p key={i} className="guidenote">{b.note}</p>
            : "steps" in b ? <ol key={i}>{b.steps.map((s, k) => <li key={k}>{s}</li>)}</ol>
            : "list" in b ? <ul key={i}>{b.list.map((s, k) => <li key={k}>{s}</li>)}</ul>
            : <dl key={i}>{b.qa.map(([question, answer], k) => <Fragment key={k}><dt>{question}</dt><dd>{answer}</dd></Fragment>)}</dl>)}
        </div>)}
      </article>}
    </div>}
  </section>;
}
